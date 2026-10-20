using System.Net;
using System.Net.Http.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts;

namespace LogHub.IntegrationTests;

/// <summary>/api/v1/alerts and the alert job, sending real emails to a Mailpit container.</summary>
[Collection(LogHubCollection.Name)]
public class AlertsTests(LogHubFixture fixture, MailpitFixture mailpit) : IClassFixture<MailpitFixture>
{
    private const string PublicUrl = "https://loghub.example.test";

    private static CancellationToken Cancellation => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Alerts_can_be_created_updated_and_deleted()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        // Disabled: the background check must not send anything for it.
        var input = AlertInput("CRUD alert", ["ops@example.test"]) with { IsEnabled = false };

        using var created = await client.PostAsJsonAsync("/api/v1/alerts", input, Cancellation);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var alert = await created.Content.ReadFromJsonAsync<AlertDto>(TestApi.Json, Cancellation) ?? throw new InvalidOperationException("Empty response.");
        try
        {
            Assert.Equal("CRUD alert", alert.Title);
            Assert.Equal(["Error", "Fatal"], alert.Filter.Levels ?? []);
            Assert.Equal(["ops@example.test"], alert.Recipients);
            Assert.False(alert.IsEnabled);
            Assert.Null(alert.LastTriggeredDate);

            using var updated = await client.PutAsJsonAsync($"/api/v1/alerts/{alert.Id}", input with { Title = "Renamed", Threshold = 7 }, Cancellation);
            Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
            var saved = await updated.Content.ReadFromJsonAsync<AlertDto>(TestApi.Json, Cancellation);
            Assert.Equal("Renamed", saved?.Title);
            Assert.Equal(7, saved?.Threshold);

            var list = await client.GetFromJsonAsync<List<AlertDto>>("/api/v1/alerts", TestApi.Json, Cancellation);
            Assert.Contains(list ?? [], a => a.Id == alert.Id && a.Title == "Renamed");

            var notifications = await client.GetFromJsonAsync<List<NotificationDto>>($"/api/v1/alerts/{alert.Id}/notifications", TestApi.Json, Cancellation);
            Assert.Empty(notifications ?? []);

            using var missing = await client.PutAsJsonAsync("/api/v1/alerts/999999999", input, Cancellation);
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        }
        finally
        {
            using var deleted = await client.DeleteAsync($"/api/v1/alerts/{alert.Id}", Cancellation);
            Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        }

        using var deletedAgain = await client.DeleteAsync($"/api/v1/alerts/{alert.Id}", Cancellation);
        Assert.Equal(HttpStatusCode.NotFound, deletedAgain.StatusCode);
    }

    public static TheoryData<string> InvalidAlerts() =>
    [
        """{"title":"","recipients":["a@example.test"]}""",
        """{"title":"x","threshold":0,"recipients":["a@example.test"]}""",
        """{"title":"x","windowMinutes":0,"recipients":["a@example.test"]}""",
        """{"title":"x","windowMinutes":1441,"recipients":["a@example.test"]}""",
        """{"title":"x","suppressionMinutes":-1,"recipients":["a@example.test"]}""",
        """{"title":"x","suppressionMinutes":10081,"recipients":["a@example.test"]}""",
        """{"title":"x","recipients":[]}""",
        """{"title":"x","recipients":["not-an-email"]}""",
        """{"title":"x","recipients":[""" + string.Join(',', Enumerable.Range(1, 21).Select(i => $"\"r{i}@example.test\"")) + "]}",
        """{"title":"x","filter":{"levels":["Loud"]},"recipients":["a@example.test"]}""",
        """{"title":"x","filter":{"properties":["NoEquals"]},"recipients":["a@example.test"]}""",
        """{"title":"x","signalId":999999999,"recipients":["a@example.test"]}""",
    ];

    [Theory]
    [MemberData(nameof(InvalidAlerts))]
    public async Task Invalid_alerts_are_rejected(string body)
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Project);
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        using var response = await client.PostAsync("/api/v1/alerts", content, Cancellation);

        await response.AssertErrorAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Read_permission_lists_but_cannot_change()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Read);

        using var list = await client.GetAsync("/api/v1/alerts", Cancellation);
        using var create = await client.PostAsJsonAsync("/api/v1/alerts", AlertInput("Nope", ["a@example.test"]), Cancellation);

        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task Triggered_alert_sends_one_email_then_is_suppressed()
    {
        await ConfigureSmtpAsync();
        var run = Guid.NewGuid().ToString("N");
        var recipient = $"ops-{run}@example.test";
        var apiKeyId = await SeedAsync(run, 3, "Error");
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        var alert = await CreateAlertAsync(client, AlertInput($"Billing errors {run}", [recipient], run) with { Threshold = 2 });
        try
        {
            var service = fixture.GetService<AlertService>();
            Assert.NotNull(await service.RunOnceAsync(Cancellation));

            var message = Assert.Single(await mailpit.WaitForMessagesAsync(recipient, 1));
            Assert.Equal($"[LogHub] Billing errors {run}: 3 events in the last 10 min", message.Subject);
            var detail = await mailpit.GetMessageAsync(message.Id);
            Assert.Contains("Error", detail.Text);
            Assert.Contains("Failure 3", detail.Text);
            Assert.Contains($"{PublicUrl}/events?levels=Error%2CFatal&property=Run%3D{run}&from=", detail.Text);
            Assert.Contains("<table", detail.Html);

            var notification = Assert.Single(await GetNotificationsAsync(client, alert.Id));
            Assert.Equal("Sent", notification.Status);
            Assert.Equal(3, notification.EventCount);
            Assert.Equal([recipient], notification.Recipients);
            Assert.Null(notification.Error);

            var saved = await GetAlertAsync(client, alert.Id);
            Assert.NotNull(saved.LastTriggeredDate);
            Assert.NotNull(saved.LastCheckedDate);
            Assert.Null(saved.LastError);

            // Within the suppression window: checked again, but no second email.
            Assert.NotNull(await service.RunOnceAsync(Cancellation));
            await Task.Delay(500, Cancellation);
            Assert.Single(await mailpit.WaitForMessagesAsync(recipient, 1));
            Assert.Single(await GetNotificationsAsync(client, alert.Id));
            Assert.Equal(3, (await fixture.WaitForEventsAsync(apiKeyId, 3)).Count);
        }
        finally
        {
            await DeleteAlertAsync(client, alert.Id);
        }
    }

    [Fact]
    public async Task Below_threshold_nothing_is_sent()
    {
        await ConfigureSmtpAsync();
        var run = Guid.NewGuid().ToString("N");
        var recipient = $"quiet-{run}@example.test";
        await SeedAsync(run, 1, "Error");
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        var alert = await CreateAlertAsync(client, AlertInput("Quiet", [recipient], run) with { Threshold = 5 });
        try
        {
            Assert.NotNull(await fixture.GetService<AlertService>().RunOnceAsync(Cancellation));

            Assert.Empty(await GetNotificationsAsync(client, alert.Id));
            var saved = await GetAlertAsync(client, alert.Id);
            Assert.NotNull(saved.LastCheckedDate);
            Assert.Null(saved.LastTriggeredDate);
        }
        finally
        {
            await DeleteAlertAsync(client, alert.Id);
        }
    }

    [Fact]
    public async Task Test_endpoint_sends_now_and_records_the_notification()
    {
        await ConfigureSmtpAsync();
        var run = Guid.NewGuid().ToString("N");
        var recipient = $"test-{run}@example.test";
        await SeedAsync(run, 1, "Fatal");
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        var alert = await CreateAlertAsync(client, AlertInput("Manual test", [recipient], run) with { Threshold = 100, IsEnabled = false });
        try
        {
            using var response = await client.PostAsync($"/api/v1/alerts/{alert.Id}/test", null, Cancellation);
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

            var message = Assert.Single(await mailpit.WaitForMessagesAsync(recipient, 1));
            Assert.StartsWith("[LogHub] Test: Manual test: 1 events", message.Subject);
            var notification = Assert.Single(await GetNotificationsAsync(client, alert.Id));
            Assert.Equal("Sent", notification.Status);
            Assert.Equal(1, notification.EventCount);
            Assert.Null((await GetAlertAsync(client, alert.Id)).LastTriggeredDate);

            using var missing = await client.PostAsync("/api/v1/alerts/999999999/test", null, Cancellation);
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        }
        finally
        {
            await DeleteAlertAsync(client, alert.Id);
        }
    }

    [Fact]
    public async Task Missing_smtp_records_a_failed_notification()
    {
        await using (var connection = await fixture.DataSource().OpenConnectionAsync(Cancellation))
        {
            await connection.ExecuteAsync("""delete from setting where name = 'Smtp'""");
        }

        var run = Guid.NewGuid().ToString("N");
        await SeedAsync(run, 1, "Error");
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        var alert = await CreateAlertAsync(client, AlertInput("No SMTP", [$"nobody-{run}@example.test"], run));
        try
        {
            Assert.NotNull(await fixture.GetService<AlertService>().RunOnceAsync(Cancellation));

            var notifications = await GetNotificationsAsync(client, alert.Id);
            Assert.NotEmpty(notifications);
            Assert.All(notifications, n =>
            {
                Assert.Equal("Failed", n.Status);
                Assert.Equal("SMTP is not configured", n.Error);
            });

            var saved = await GetAlertAsync(client, alert.Id);
            Assert.Equal("SMTP is not configured", saved.LastError);
            Assert.Null(saved.LastTriggeredDate);

            using var test = await client.PostAsync($"/api/v1/alerts/{alert.Id}/test", null, Cancellation);
            await test.AssertErrorAsync(HttpStatusCode.BadRequest);
        }
        finally
        {
            await DeleteAlertAsync(client, alert.Id);
        }
    }

    private static AlertInputDto AlertInput(string title, string[] recipients, string? run = null) => new(
        title,
        "Integration test alert",
        null,
        new FilterDto(["Error", "Fatal"], run is null ? null : [$"Run={run}"]),
        1,
        10,
        60,
        recipients,
        true);

    private async Task ConfigureSmtpAsync()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System);
        using var response = await client.PutAsJsonAsync(
            "/api/v1/settings/smtp",
            new { host = mailpit.Host, port = mailpit.Port, security = "None", fromAddress = "loghub@example.test", fromName = "LogHub Tests", publicUrl = PublicUrl },
            Cancellation);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>Ingests events tagged with Run=run, one second apart and ending now.</summary>
    private async Task<long> SeedAsync(string run, int count, string level)
    {
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        var now = DateTimeOffset.UtcNow;
        await fixture.IngestAsync(
            token,
            Enumerable.Range(1, count).Select(i => TestApi.Clef(now.AddSeconds(i - count), $"Failure {i}", run, level)).ToArray());
        Assert.Equal(count, (await fixture.WaitForEventsAsync(apiKeyId, count)).Count);
        return apiKeyId;
    }

    private static async Task<AlertDto> CreateAlertAsync(HttpClient client, AlertInputDto input)
    {
        using var response = await client.PostAsJsonAsync("/api/v1/alerts", input, Cancellation);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<AlertDto>(TestApi.Json, Cancellation) ?? throw new InvalidOperationException("Empty response.");
    }

    private static async Task<AlertDto> GetAlertAsync(HttpClient client, long id) =>
        Assert.Single(await client.GetFromJsonAsync<List<AlertDto>>("/api/v1/alerts", TestApi.Json, Cancellation) ?? [], a => a.Id == id);

    private static async Task<List<NotificationDto>> GetNotificationsAsync(HttpClient client, long id) =>
        await client.GetFromJsonAsync<List<NotificationDto>>($"/api/v1/alerts/{id}/notifications", TestApi.Json, Cancellation) ?? [];

    private static async Task DeleteAlertAsync(HttpClient client, long id)
    {
        using var response = await client.DeleteAsync($"/api/v1/alerts/{id}", Cancellation);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private sealed record FilterDto(string[]? Levels, string[]? Properties);

    private sealed record AlertInputDto(
        string Title,
        string? Description,
        long? SignalId,
        FilterDto Filter,
        int Threshold,
        int WindowMinutes,
        int SuppressionMinutes,
        string[] Recipients,
        bool IsEnabled);

    private sealed record AlertDto(
        long Id,
        string Title,
        int Threshold,
        bool IsEnabled,
        FilterDto Filter,
        string[] Recipients,
        DateTimeOffset? LastCheckedDate,
        DateTimeOffset? LastTriggeredDate,
        string? LastError);

    private sealed record NotificationDto(long Id, long AlertId, long EventCount, string[] Recipients, string Status, string? Error);
}
