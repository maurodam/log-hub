using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts.Email;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace LogHub.IntegrationTests;

/// <summary>/api/v1/settings/smtp: stored settings, encrypted password, test email, environment override.</summary>
[Collection(LogHubCollection.Name)]
public class SmtpSettingsTests(LogHubFixture fixture, MailpitFixture mailpit) : IClassFixture<MailpitFixture>
{
    private static CancellationToken Cancellation => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Settings_round_trip_without_exposing_the_password()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System);

        using var saved = await client.PutAsJsonAsync("/api/v1/settings/smtp", Settings(password: "s3cret-Passw0rd"), Cancellation);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.ReadJsonAsync();
        Assert.False(body.TryGetProperty("password", out _));
        Assert.True(body.GetProperty("hasPassword").GetBoolean());
        Assert.True(body.GetProperty("isConfigured").GetBoolean());
        Assert.False(body.GetProperty("isFromEnvironment").GetBoolean());
        Assert.Equal("smtp.example.test", body.GetProperty("host").GetString());
        Assert.Equal(2525, body.GetProperty("port").GetInt32());
        Assert.Equal("StartTls", body.GetProperty("security").GetString());
        Assert.Equal("https://loghub.example.test", body.GetProperty("publicUrl").GetString());

        // The password is stored encrypted, and decrypts for sending.
        await using (var connection = await fixture.DataSource().OpenConnectionAsync(Cancellation))
        {
            var stored = await connection.ExecuteScalarAsync<string>("""select value::text from setting where name = 'Smtp'""");
            Assert.DoesNotContain("s3cret-Passw0rd", stored);
        }

        Assert.Equal("s3cret-Passw0rd", (await fixture.GetService<SmtpSettingsStore>().GetConfigurationAsync(Cancellation))?.Password);

        // password null keeps the stored one.
        using var kept = await client.PutAsJsonAsync("/api/v1/settings/smtp", Settings(password: null) with { Port = 2526 }, Cancellation);
        Assert.Equal(HttpStatusCode.OK, kept.StatusCode);
        var settings = await client.GetFromJsonAsync<JsonElement>("/api/v1/settings/smtp", TestApi.Json, Cancellation);
        Assert.True(settings.GetProperty("hasPassword").GetBoolean());
        Assert.Equal(2526, settings.GetProperty("port").GetInt32());
        Assert.Equal("s3cret-Passw0rd", (await fixture.GetService<SmtpSettingsStore>().GetConfigurationAsync(Cancellation))?.Password);

        // An empty password removes it.
        using var cleared = await client.PutAsJsonAsync("/api/v1/settings/smtp", Settings(password: ""), Cancellation);
        Assert.False((await cleared.ReadJsonAsync()).GetProperty("hasPassword").GetBoolean());
    }

    public static TheoryData<string> InvalidSettings() =>
    [
        """{"host":"","port":25,"security":"None","fromAddress":"a@example.test"}""",
        """{"host":"smtp","port":0,"security":"None","fromAddress":"a@example.test"}""",
        """{"host":"smtp","port":65536,"security":"None","fromAddress":"a@example.test"}""",
        """{"host":"smtp","port":25,"security":"Tls","fromAddress":"a@example.test"}""",
        """{"host":"smtp","port":25,"security":"None","fromAddress":"not-an-email"}""",
        """{"host":"smtp","port":25,"security":"None","fromAddress":"a@example.test","publicUrl":"ftp://loghub"}""",
        """{"host":"smtp","port":25,"security":"None","fromAddress":"a@example.test","publicUrl":"/relative"}""",
    ];

    [Theory]
    [MemberData(nameof(InvalidSettings))]
    public async Task Invalid_settings_are_rejected(string body)
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System);
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        using var response = await client.PutAsync("/api/v1/settings/smtp", content, Cancellation);

        await response.AssertErrorAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Requires_system_permission()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project, Permissions.Organization);

        using var get = await client.GetAsync("/api/v1/settings/smtp", Cancellation);
        using var put = await client.PutAsJsonAsync("/api/v1/settings/smtp", Settings(password: null), Cancellation);

        Assert.Equal(HttpStatusCode.Forbidden, get.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }

    [Fact]
    public async Task Test_email_is_delivered_through_smtp()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System);
        var recipient = $"smtp-test-{Guid.NewGuid():N}@example.test";
        using var saved = await client.PutAsJsonAsync(
            "/api/v1/settings/smtp",
            new SettingsDto(mailpit.Host, mailpit.Port, null, null, "None", "loghub@example.test", "LogHub Tests", null),
            Cancellation);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        using var sent = await client.PostAsJsonAsync("/api/v1/settings/smtp/test", new { to = recipient }, Cancellation);
        using var invalid = await client.PostAsJsonAsync("/api/v1/settings/smtp/test", new { to = "nope" }, Cancellation);

        Assert.Equal(HttpStatusCode.NoContent, sent.StatusCode);
        await invalid.AssertErrorAsync(HttpStatusCode.BadRequest);
        var message = Assert.Single(await mailpit.WaitForMessagesAsync(recipient, 1));
        Assert.Equal("[LogHub] Test email", message.Subject);
        Assert.Equal("loghub@example.test", message.From.Address);
        Assert.Equal("LogHub Tests", message.From.Name);
    }

    [Fact]
    public async Task Test_email_failure_returns_bad_gateway()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System);
        using var saved = await client.PutAsJsonAsync(
            "/api/v1/settings/smtp",
            new SettingsDto("127.0.0.1", 1, null, null, "None", "loghub@example.test", null, null),
            Cancellation);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        using var response = await client.PostAsJsonAsync("/api/v1/settings/smtp/test", new { to = "ops@example.test" }, Cancellation);

        await response.AssertErrorAsync(HttpStatusCode.BadGateway);
    }

    /// <summary>
    /// The shared test host has no Smtp:* configuration, so the override is checked on a store built with its own configuration
    /// (same database and Data Protection keys as the host).
    /// </summary>
    [Fact]
    public async Task Environment_configuration_overrides_and_blocks_changes()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Smtp:Host"] = "smtp.env.test",
                ["Smtp:Port"] = "2525",
                ["Smtp:Password"] = "from-env",
                ["Smtp:Security"] = "SslOnConnect",
                ["Smtp:FromAddress"] = "env@example.test",
                ["Smtp:PublicUrl"] = "https://env.example.test/",
            })
            .Build();
        var store = new SmtpSettingsStore(fixture.DataSource(), fixture.GetService<IDataProtectionProvider>(), configuration);

        var settings = await store.GetAsync(Cancellation);
        var result = await SmtpSettingsEndpoints.Update(
            new SmtpSettingsInput("other", 25, null, null, "None", "a@example.test", null, null),
            new ClaimsPrincipal(),
            store,
            Cancellation);

        Assert.True(settings.IsFromEnvironment);
        Assert.True(settings.IsConfigured);
        Assert.True(settings.HasPassword);
        Assert.Equal("smtp.env.test", settings.Host);
        Assert.Equal(2525, settings.Port);
        Assert.Equal("SslOnConnect", settings.Security);
        Assert.Equal("https://env.example.test", settings.PublicUrl);
        Assert.Equal("from-env", (await store.GetConfigurationAsync(Cancellation))?.Password);
        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
    }

    private static SettingsDto Settings(string? password) =>
        new("smtp.example.test", 2525, "mailer", password, "StartTls", "loghub@example.test", "LogHub", "https://loghub.example.test/");

    private sealed record SettingsDto(
        string Host,
        int Port,
        string? Username,
        string? Password,
        string Security,
        string FromAddress,
        string? FromName,
        string? PublicUrl);
}
