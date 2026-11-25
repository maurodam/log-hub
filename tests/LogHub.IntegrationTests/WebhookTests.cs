using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts;
using LogHub.Api.Features.Alerts.Webhooks;

namespace LogHub.IntegrationTests;

public sealed class WebhookTestReceiver : HttpMessageHandler
{
    public sealed record Request(Uri Url, string Body, string? Timestamp, string? Signature);
    public ConcurrentQueue<Request> Requests { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var ordinal = Requests.Count(item => item.Url == request.RequestUri);
        Requests.Enqueue(new Request(request.RequestUri!, await request.Content!.ReadAsStringAsync(cancellationToken),
            request.Headers.TryGetValues("X-LogHub-Timestamp", out var timestamp) ? timestamp.Single() : null,
            request.Headers.TryGetValues("X-LogHub-Signature", out var signature) ? signature.Single() : null));

        if (request.RequestUri!.AbsolutePath.Contains("/limited/", StringComparison.Ordinal) && ordinal == 0)
        {
            return new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            {
                Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(1)) },
            };
        }
        if (request.RequestUri.AbsolutePath.Contains("/revoked/", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(HttpStatusCode.Gone);
        }
        return new HttpResponseMessage(request.RequestUri.Host.Contains("platform", StringComparison.Ordinal)
            ? HttpStatusCode.Accepted : HttpStatusCode.OK);
    }
}

[Collection(LogHubCollection.Name)]
public class WebhookTests(LogHubFixture fixture, MailpitFixture mailpit) : IClassFixture<MailpitFixture>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Dispatches_multiple_channels_and_retries_with_the_same_signed_payload()
    {
        using var admin = await fixture.CreateApiClientAsync(Permissions.System, Permissions.Project, Permissions.Read);
        using var project = await fixture.CreateApiClientAsync(Permissions.Project, Permissions.Read);
        var marker = Guid.NewGuid().ToString("N");
        var recipient = $"webhook-{marker}@example.test";
        using var smtp = await admin.PutAsJsonAsync("/api/v1/settings/smtp",
            new { host = mailpit.Host, port = mailpit.Port, security = "None", fromAddress = "loghub@example.test" }, Ct);
        smtp.EnsureSuccessStatusCode();
        const string signingSecret = "test-fixture-signing-secret-with-32-characters";
        var genericUrl = $"https://webhook.example.test/limited/{marker}";
        var generic = await Create(admin, new(marker, "generic", genericUrl, signingSecret));
        var slack = await Create(admin, new(marker, "slack", $"https://hooks.slack.com/services/revoked/{marker}", null));
        var teams = await Create(admin, new(marker, "teams", $"https://test.environment.api.powerplatform.com/workflows/{marker}", null));

        using var forbidden = await project.GetAsync("/api/v1/settings/webhooks", Ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var choices = await project.GetAsync("/api/v1/alerts/webhook-destinations", Ct);
        choices.EnsureSuccessStatusCode();
        var visible = await choices.Content.ReadAsStringAsync(Ct);
        Assert.DoesNotContain(signingSecret, visible);
        Assert.DoesNotContain(genericUrl, visible);

        using var created = await project.PostAsJsonAsync("/api/v1/alerts",
            new AlertInput(marker, null, null, new() { Properties = [$"Run={marker}"] }, Recipients: [recipient], WebhookDestinationIds: [generic, slack, teams]), Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var alert = (await created.Content.ReadFromJsonAsync<AlertDto>(TestApi.Json, Ct))!;
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(token, TestApi.Clef(DateTimeOffset.UtcNow, "sensitive-event-text", marker, "Error"));

        var evaluator = fixture.GetService<AlertService>();
        Assert.NotNull(await evaluator.RunOnceAsync(Ct));
        Assert.NotNull(await evaluator.RunOnceAsync(Ct));

        var first = await DrainUntil(project, alert.Id, history =>
            history.Count == 4 && history.Where(item => item.Kind is not null)
                .All(item => item.Attempts == 1 && (item.Status != "Pending" || item.Error == "HTTP 429")));
        Assert.Equal("Sent", first.Single(item => item.Kind == "teams").Status);
        Assert.Equal("Sent", first.Single(item => item.Kind is null).Status);
        Assert.Single(await mailpit.WaitForMessagesAsync(recipient, 1));
        Assert.Equal("Failed", first.Single(item => item.Kind == "slack").Status);
        var pending = first.Single(item => item.Kind == "generic");
        Assert.Equal("Pending", pending.Status);
        Assert.Equal(1, pending.EventCount);
        Assert.NotNull(pending.DeliveryId);

        await using (var db = await fixture.DataSource().OpenConnectionAsync(Ct))
        {
            var retryAfter = await db.ExecuteScalarAsync<double>(new CommandDefinition(
                "select extract(epoch from next_attempt - now())::float8 from webhook_delivery where id = @id",
                new { id = pending.DeliveryId }, cancellationToken: Ct));
            Assert.InRange(retryAfter, 40, 65);
            // Mark the outstanding delivery due, as it would be after a process recovers an expired lease.
            await db.ExecuteAsync(new CommandDefinition(
                "update webhook_delivery set next_attempt = now(), lease_id = gen_random_uuid() where id = @id",
                new { id = pending.DeliveryId }, cancellationToken: Ct));
        }

        var completed = await DrainUntil(project, alert.Id, history => history.Any(item => item.Id == pending.Id && item.Status == "Sent"));
        Assert.Equal(2, completed.Single(item => item.Id == pending.Id).Attempts);
        var attempts = fixture.Webhooks.Requests.Where(request => request.Url.AbsoluteUri == genericUrl).ToArray();
        Assert.Equal(2, attempts.Length);
        Assert.Equal(attempts[0].Body, attempts[1].Body);
        Assert.DoesNotContain("sensitive-event-text", attempts[1].Body);
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(signingSecret), Encoding.UTF8.GetBytes($"{attempts[1].Timestamp}.{attempts[1].Body}"));
        Assert.Equal($"sha256={Convert.ToHexStringLower(expected)}", attempts[1].Signature);
        using var json = JsonDocument.Parse(attempts[1].Body);
        Assert.Equal(pending.DeliveryId.Value, json.RootElement.GetProperty("deliveryId").GetInt64());
        Assert.False(json.RootElement.GetProperty("isTest").GetBoolean());
        var card = fixture.Webhooks.Requests.Single(request => request.Url.Host.Contains("platform") && request.Url.AbsolutePath.EndsWith(marker));
        Assert.Contains("application/vnd.microsoft.card.adaptive", card.Body);

        using var testResponse = await project.PostAsync($"/api/v1/alerts/{alert.Id}/webhooks/{teams}/test", null, Ct);
        Assert.Equal(HttpStatusCode.Accepted, testResponse.StatusCode);
        await DrainUntil(project, alert.Id, history => history.Any(item => item.IsTest && item.Status == "Sent" && item.EventCount == 0));
        await project.DeleteAsync($"/api/v1/alerts/{alert.Id}", Ct);
    }

    private async Task<List<NotificationDto>> DrainUntil(HttpClient client, long id, Func<List<NotificationDto>, bool> ready)
    {
        var worker = fixture.GetService<WebhookDelivery>();
        for (var i = 0; i < 50; i++)
        {
            await Task.WhenAll(worker.RunOnceAsync(Ct), worker.RunOnceAsync(Ct));
            var history = (await client.GetFromJsonAsync<List<NotificationDto>>($"/api/v1/alerts/{id}/notifications", TestApi.Json, Ct))!;
            if (ready(history)) return history;
            await Task.Delay(50, Ct);
        }
        throw new InvalidOperationException("Expected webhook deliveries did not finish.");
    }

    private static async Task<long> Create(HttpClient client, WebhookInput input)
    {
        using var response = await client.PostAsJsonAsync("/api/v1/settings/webhooks", input, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadJsonAsync()).GetProperty("id").GetInt64();
    }
}
