using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using LogHub.Api.Common.Security;
using Serilog;
using Serilog.Core;
using Serilog.Events;

namespace LogHub.IntegrationTests;

/// <summary>Ingestion end to end, driven by the real Serilog.Sinks.Seq package.</summary>
[Collection(LogHubCollection.Name)]
public class IngestionTests(LogHubFixture fixture)
{
    private const string ClefContentType = "application/vnd.serilog.clef";

    [Fact]
    public async Task Serilog_sink_events_are_stored()
    {
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest], appliedProperties: """{"App":"Tests"}""");

        using (var logger = CreateSeqLogger(token))
        {
            logger.Information("User {UserId} logged in from {Ip}", 42, "10.0.0.1");
            logger.Warning("Disk at {Percent:0.0}%", 91.234);
            logger.Error(new InvalidOperationException("boom"), "Failed to process {@Order}", new { Id = 7, Total = 12.5 });
        }

        var events = await fixture.WaitForEventsAsync(apiKeyId, 3);

        Assert.Equal(3, events.Count);

        var info = events[0];
        Assert.Equal("Information", info.Level);
        Assert.Equal(2, info.LevelRank);
        Assert.Equal("User {UserId} logged in from {Ip}", info.MessageTemplate);
        Assert.Equal("User 42 logged in from 10.0.0.1", info.Message);
        Assert.NotEqual(0, info.EventType);
        using (var properties = JsonDocument.Parse(info.Properties))
        {
            Assert.Equal(42, properties.RootElement.GetProperty("UserId").GetInt32());
            Assert.Equal("Tests", properties.RootElement.GetProperty("App").GetString());
        }

        var warning = events[1];
        Assert.Equal(3, warning.LevelRank);
        Assert.Equal("Disk at 91.2%", warning.Message);

        var error = events[2];
        Assert.Equal(4, error.LevelRank);
        Assert.Contains("InvalidOperationException: boom", error.Exception);
        using (var properties = JsonDocument.Parse(error.Properties))
        {
            Assert.Equal(7, properties.RootElement.GetProperty("Order").GetProperty("Id").GetInt32());
        }
    }

    [Fact]
    public async Task Api_key_minimum_level_controls_the_sink_level()
    {
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest], minimumLevel: "Warning");
        var levelSwitch = new LoggingLevelSwitch(LogEventLevel.Verbose);

        using (var logger = CreateSeqLogger(token, levelSwitch))
        {
            logger.Information("Dropped by the server");
            logger.Warning("Kept");
        }

        Assert.Equal(LogEventLevel.Warning, levelSwitch.MinimumLevel);
        var stored = Assert.Single(await fixture.WaitForEventsAsync(apiKeyId, 1));
        Assert.Equal("Kept", stored.Message);
    }

    [Theory]
    [InlineData(null, """{"MinimumLevelAccepted":null}""")]
    [InlineData("Error", """{"MinimumLevelAccepted":"Error"}""")]
    public async Task Empty_body_returns_the_minimum_level_as_compact_json(string? minimumLevel, string expected)
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest], minimumLevel);

        using var response = await PostAsync("/api/events/raw", string.Empty, token);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(expected, await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Clef_endpoint_accepts_legacy_payload_and_query_api_key()
    {
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        var legacy = """
            {"Events":[{"Timestamp":"2026-10-20T08:00:00Z","Level":"Error","MessageTemplate":"Order {OrderId} failed","Properties":{"OrderId":7}}]}
            """;

        using var response = await PostAsync($"/ingest/clef?apiKey={token}", legacy, token: null, contentType: "application/json");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var stored = Assert.Single(await fixture.WaitForEventsAsync(apiKeyId, 1));
        Assert.Equal("Order 7 failed", stored.Message);
        Assert.Equal(4, stored.LevelRank);
    }

    [Fact]
    public async Task Missing_api_key_is_rejected()
    {
        using var response = await PostAsync("/api/events/raw", """{"@t":"2026-10-20T08:00:00Z"}""", token: null);

        await AssertErrorAsync(response, HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Unknown_api_key_is_rejected()
    {
        using var response = await PostAsync("/api/events/raw", """{"@t":"2026-10-20T08:00:00Z"}""", "not-a-real-key");

        await AssertErrorAsync(response, HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Api_key_without_ingest_permission_is_forbidden()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);

        using var response = await PostAsync("/api/events/raw", """{"@t":"2026-10-20T08:00:00Z"}""", token);

        await AssertErrorAsync(response, HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Malformed_payload_is_rejected_and_nothing_is_stored()
    {
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);

        using var response = await PostAsync("/api/events/raw", "{\"@t\":\"2026-10-20T08:00:00Z\"}\n{broken", token);

        await AssertErrorAsync(response, HttpStatusCode.BadRequest);
        Assert.Empty(await fixture.WaitForEventsAsync(apiKeyId, 0));
    }

    private Logger CreateSeqLogger(string apiKey, LoggingLevelSwitch? levelSwitch = null) =>
        new LoggerConfiguration()
            .MinimumLevel.Verbose()
            .WriteTo.Seq(
                "http://localhost",
                apiKey: apiKey,
                period: TimeSpan.FromMilliseconds(50),
                controlLevelSwitch: levelSwitch,
                messageHandler: fixture.Factory.Server.CreateHandler(),
                formatProvider: CultureInfo.InvariantCulture)
            .CreateLogger();

    private async Task<HttpResponseMessage> PostAsync(string path, string body, string? token, string contentType = ClefContentType)
    {
        using var client = fixture.Factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(body, Encoding.UTF8, contentType),
        };

        if (token is not null)
        {
            request.Headers.Add("X-Seq-ApiKey", token);
        }

        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task AssertErrorAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert.Equal(expected, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.False(string.IsNullOrEmpty(body.RootElement.GetProperty("Error").GetString()));
    }
}
