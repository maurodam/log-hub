using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts;
using LogHub.Api.Features.Alerts.Webhooks;

namespace LogHub.IntegrationTests;

[Collection(LogHubCollection.Name)]
public sealed class SchedulerTests : IAsyncLifetime
{
    private const string Secret = "scheduler-test-secret-at-least-32-characters";
    private readonly LogHubFixture fixture = new();
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public ValueTask InitializeAsync() => fixture.InitializeAsync(Secret);

    public ValueTask DisposeAsync() => fixture.DisposeAsync();

    [Fact]
    public async Task Each_job_requires_the_dedicated_bearer_secret()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System, Permissions.Project);
        foreach (var job in new[] { "alerts", "webhooks", "retention" })
        {
            client.DefaultRequestHeaders.Authorization = null;
            using var missing = await client.PostAsync($"/api/internal/jobs/{job}", null, Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);

            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "invalid-secret");
            using var invalid = await client.PostAsync($"/api/internal/jobs/{job}", null, Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);

            await TickAsync(client, job);
        }
    }

    [Fact]
    public async Task Manual_retention_survives_a_new_host_and_waits_when_a_run_already_holds_the_lock()
    {
        const long retentionLock = 0x4C6F674875625274;
        using var client = await fixture.CreateApiClientAsync(Permissions.Project);
        await TickAsync(client, "retention");
        await TickAsync(client, "retention");

        await using var db = await fixture.DataSource().OpenConnectionAsync(Ct);
        var first = await db.ExecuteScalarAsync<DateTime>("select completed_at from retention_schedule where id = 1");
        await TickAsync(client, "retention");
        Assert.Equal(first, await db.ExecuteScalarAsync<DateTime>("select completed_at from retention_schedule where id = 1"));

        using var request = await client.PostAsync("/api/v1/retention/run", null, Ct);
        Assert.Equal(HttpStatusCode.Accepted, request.StatusCode);

        await using var replacement = fixture.Factory.WithWebHostBuilder(_ => { });
        using var replacementClient = replacement.CreateClient();
        await db.ExecuteAsync("select pg_advisory_lock(@retentionLock)", new { retentionLock });
        try
        {
            await TickAsync(replacementClient, "retention");
            Assert.True(await db.ExecuteScalarAsync<bool>("select requested_version > completed_version from retention_schedule where id = 1"));
        }
        finally
        {
            await db.ExecuteAsync("select pg_advisory_unlock(@retentionLock)", new { retentionLock });
        }

        await TickAsync(replacementClient, "retention");
        Assert.True(await db.ExecuteScalarAsync<bool>("select requested_version = completed_version from retention_schedule where id = 1"));
        Assert.True(await db.ExecuteScalarAsync<DateTime>("select completed_at from retention_schedule where id = 1") > first);
    }

    [Fact]
    public async Task Alert_tick_enqueues_and_overlapping_webhook_ticks_retry_a_due_delivery_once()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.System, Permissions.Project);
        var marker = Guid.NewGuid().ToString("N");
        var url = $"https://webhook.example.test/limited/{marker}";
        using var destination = await client.PostAsJsonAsync("/api/v1/settings/webhooks",
            new WebhookInput(marker, "generic", url, Secret), Ct);
        Assert.Equal(HttpStatusCode.Created, destination.StatusCode);
        var destinationId = (await destination.ReadJsonAsync()).GetProperty("id").GetInt64();
        using var alert = await client.PostAsJsonAsync("/api/v1/alerts",
            new AlertInput(marker, null, null, new() { Properties = [$"Run={marker}"] }, WebhookDestinationIds: [destinationId]), Ct);
        Assert.Equal(HttpStatusCode.Created, alert.StatusCode);
        var alertId = (await alert.ReadJsonAsync()).GetProperty("id").GetInt64();
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(token, TestApi.Clef(DateTimeOffset.UtcNow, "Scheduled test", marker, "Error"));

        await TickAsync(client, "alerts");
        await using var db = await fixture.DataSource().OpenConnectionAsync(Ct);
        await db.ExecuteAsync("update webhook_delivery set next_attempt = now() where alert_id = @alertId", new { alertId });
        await TickAsync(client, "webhooks");
        Assert.Equal(("Pending", 1, "HTTP 429"), await db.QuerySingleAsync<(string Status, int Attempts, string Error)>(
            "select status, attempts, error from webhook_delivery where alert_id = @alertId", new { alertId }));

        await db.ExecuteAsync(
            "update webhook_delivery set next_attempt = now(), lease_id = gen_random_uuid() where alert_id = @alertId", new { alertId });
        using var otherClient = fixture.Factory.CreateClient();
        await Task.WhenAll(TickAsync(client, "webhooks"), TickAsync(otherClient, "webhooks"));

        Assert.Equal("Sent", await db.ExecuteScalarAsync<string>(
            "select status from webhook_delivery where alert_id = @alertId", new { alertId }));
        Assert.Equal(2, fixture.Webhooks.Requests.Count(request => request.Url.AbsoluteUri == url));
    }

    private static async Task TickAsync(HttpClient client, string job)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/internal/jobs/{job}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Secret);
        using var response = await client.SendAsync(request, Ct);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }
}

[Collection(LogHubCollection.Name)]
public sealed class SchedulerDisabledTests(LogHubFixture fixture)
{
    [Fact]
    public async Task Default_host_does_not_expose_job_endpoints()
    {
        using var client = fixture.Factory.CreateClient();
        using var response = await client.PostAsync("/api/internal/jobs/retention", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
