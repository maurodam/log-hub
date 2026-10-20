using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Retention;

namespace LogHub.IntegrationTests;

/// <summary>/api/v1/retention and the retention job. Policies created here never outlive the test.</summary>
[Collection(LogHubCollection.Name)]
public class RetentionTests(LogHubFixture fixture)
{
    private static CancellationToken Cancellation => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Policies_can_be_created_updated_and_deleted()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);

        using var created = await client.PostAsJsonAsync("/api/v1/retention", new { signalId = (long?)null, retentionDays = 30, isEnabled = false }, Cancellation);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var policy = await created.Content.ReadFromJsonAsync<PolicyDto>(TestApi.Json, Cancellation);
        Assert.NotNull(policy);
        try
        {
            Assert.Null(policy.SignalId);
            Assert.Equal(30, policy.RetentionDays);
            Assert.False(policy.IsEnabled);
            Assert.Equal($"/api/v1/retention/{policy.Id}", created.Headers.Location?.OriginalString);

            using var duplicate = await client.PostAsJsonAsync("/api/v1/retention", new { signalId = (long?)null, retentionDays = 10, isEnabled = false }, Cancellation);
            await duplicate.AssertErrorAsync(HttpStatusCode.Conflict);

            using var updated = await client.PutAsJsonAsync($"/api/v1/retention/{policy.Id}", new { signalId = (long?)null, retentionDays = 45, isEnabled = false }, Cancellation);
            Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
            Assert.Equal(45, (await updated.Content.ReadFromJsonAsync<PolicyDto>(TestApi.Json, Cancellation))?.RetentionDays);

            using var missing = await client.PutAsJsonAsync("/api/v1/retention/999999999", new { signalId = (long?)null, retentionDays = 45, isEnabled = false }, Cancellation);
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

            var list = await client.GetFromJsonAsync<List<PolicyDto>>("/api/v1/retention", TestApi.Json, Cancellation);
            Assert.Contains(list ?? [], p => p.Id == policy.Id && p.RetentionDays == 45);
        }
        finally
        {
            using var deleted = await client.DeleteAsync($"/api/v1/retention/{policy.Id}", Cancellation);
            Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        }

        using var deletedAgain = await client.DeleteAsync($"/api/v1/retention/{policy.Id}", Cancellation);
        Assert.Equal(HttpStatusCode.NotFound, deletedAgain.StatusCode);
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData(null, 3651)]
    [InlineData(999999999L, 10)]
    public async Task Invalid_policies_are_rejected(long? signalId, int retentionDays)
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Project);

        using var response = await client.PostAsJsonAsync("/api/v1/retention", new { signalId, retentionDays, isEnabled = false }, Cancellation);

        await response.AssertErrorAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Requires_project_permission()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Read);

        using var list = await client.GetAsync("/api/v1/retention", Cancellation);
        using var run = await client.PostAsync("/api/v1/retention/run", null, Cancellation);

        Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, run.StatusCode);
    }

    [Fact]
    public async Task Run_endpoint_starts_the_job()
    {
        using var client = await fixture.CreateApiClientAsync(Permissions.Project);

        using var response = await client.PostAsync("/api/v1/retention/run", null, Cancellation);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task Storage_lists_partitions_with_estimates()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(token, TestApi.Clef(DateTimeOffset.UtcNow, "Storage", Guid.NewGuid().ToString("N")));
        using var client = await fixture.CreateApiClientAsync(Permissions.Project);

        var storage = await client.GetFromJsonAsync<JsonElement>("/api/v1/retention/storage", TestApi.Json, Cancellation);

        Assert.True(storage.GetProperty("totalEvents").GetInt64() >= 0);
        Assert.True(storage.GetProperty("totalBytes").GetInt64() > 0);
        Assert.True(storage.TryGetProperty("oldestEvent", out _));
        var partitions = storage.GetProperty("partitions").EnumerateArray().ToList();
        var defaultPartition = Assert.Single(partitions, p => p.GetProperty("name").GetString() == EventPartitions.DefaultPartition);
        Assert.Equal(JsonValueKind.Null, defaultPartition.GetProperty("from").ValueKind);
        Assert.Equal(JsonValueKind.Null, defaultPartition.GetProperty("to").ValueKind);
        Assert.All(partitions, p =>
        {
            Assert.True(p.GetProperty("rows").GetInt64() >= 0);
            Assert.True(p.GetProperty("bytes").GetInt64() >= 0);
        });
    }

    [Fact]
    public async Task Job_creates_daily_partitions_ahead()
    {
        Assert.NotNull(await fixture.GetService<RetentionService>().RunOnceAsync(Cancellation));

        await using var connection = await fixture.DataSource().OpenConnectionAsync(Cancellation);
        var partitions = (await connection.QueryAsync<string>(
            """select c.relname::text from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'event'::regclass""")).ToHashSet();

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        Assert.Contains(EventPartitions.Name(today.AddDays(3)), partitions);

        // Tomorrow is skipped only when the default partition already holds events of that day.
        var tomorrow = today.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var tomorrowInDefault = await connection.ExecuteScalarAsync<bool>(
            """select exists (select 1 from event_default where timestamp >= @from and timestamp < @to)""",
            new { from = tomorrow, to = tomorrow.AddDays(1) });
        Assert.True(tomorrowInDefault || partitions.Contains(EventPartitions.Name(today.AddDays(1))));
    }

    [Fact]
    public async Task All_events_policy_drops_old_partitions_and_deletes_old_events()
    {
        var run = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;
        var oldDay = DateOnly.FromDateTime(now.UtcDateTime).AddDays(-400);
        var oldPartition = EventPartitions.Name(oldDay);

        await using var connection = await fixture.DataSource().OpenConnectionAsync(Cancellation);
        await connection.ExecuteAsync(string.Create(
            CultureInfo.InvariantCulture,
            $"""create table {oldPartition} partition of event for values from ('{oldDay:yyyy-MM-dd} 00:00:00+00') to ('{oldDay.AddDays(1):yyyy-MM-dd} 00:00:00+00')"""));

        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(
            token,
            TestApi.Clef(new DateTimeOffset(oldDay.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero), "In old partition", run),
            TestApi.Clef(now.AddDays(-40), "Old, in default partition", run),
            TestApi.Clef(now.AddMinutes(-1), "Recent", run));
        Assert.Equal(3, (await fixture.WaitForEventsAsync(apiKeyId, 3)).Count);

        using var client = await fixture.CreateApiClientAsync(Permissions.Project);
        var policy = await CreatePolicyAsync(client, signalId: null, retentionDays: 30);
        try
        {
            Assert.NotNull(await fixture.GetService<RetentionService>().RunOnceAsync(Cancellation));

            var remaining = await fixture.WaitForEventsAsync(apiKeyId, 0);
            Assert.Equal(["Recent"], remaining.Select(e => e.Message));

            var partitionExists = await connection.ExecuteScalarAsync<bool>(
                """select exists (select 1 from pg_class where relname = @oldPartition)""", new { oldPartition });
            Assert.False(partitionExists);

            var saved = Assert.Single(await GetPoliciesAsync(client), p => p.Id == policy.Id);
            Assert.NotNull(saved.LastRunDate);
            Assert.NotNull(saved.LastDeletedCount);
        }
        finally
        {
            await DeletePolicyAsync(client, policy.Id);
        }
    }

    [Fact]
    public async Task Signal_policy_deletes_only_matching_old_events()
    {
        var run = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;

        await using var connection = await fixture.DataSource().OpenConnectionAsync(Cancellation);
        var signalId = await connection.ExecuteScalarAsync<long>(
            """insert into signal (title, filter) values ('Retention test', @filter::jsonb) returning id """,
            new { filter = JsonSerializer.Serialize(new { levels = new[] { "Debug" }, properties = new[] { $"Run={run}" } }) });

        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(
            token,
            TestApi.Clef(now.AddDays(-3), "Old debug", run, "Debug"),
            TestApi.Clef(now.AddDays(-3).AddSeconds(1), "Old information", run),
            TestApi.Clef(now.AddMinutes(-1), "New debug", run, "Debug"));
        Assert.Equal(3, (await fixture.WaitForEventsAsync(apiKeyId, 3)).Count);

        using var client = await fixture.CreateApiClientAsync(Permissions.Project);
        var policy = await CreatePolicyAsync(client, signalId, retentionDays: 1);
        try
        {
            Assert.Equal("Retention test", policy.SignalTitle);
            Assert.NotNull(await fixture.GetService<RetentionService>().RunOnceAsync(Cancellation));

            var remaining = await fixture.WaitForEventsAsync(apiKeyId, 0);
            Assert.Equal(["Old information", "New debug"], remaining.Select(e => e.Message));
            Assert.NotNull(Assert.Single(await GetPoliciesAsync(client), p => p.Id == policy.Id).LastRunDate);
        }
        finally
        {
            await DeletePolicyAsync(client, policy.Id);
            await connection.ExecuteAsync("""delete from signal where id = @signalId""", new { signalId });
        }
    }

    private static async Task<PolicyDto> CreatePolicyAsync(HttpClient client, long? signalId, int retentionDays)
    {
        using var response = await client.PostAsJsonAsync("/api/v1/retention", new { signalId, retentionDays, isEnabled = true }, Cancellation);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<PolicyDto>(TestApi.Json, Cancellation) ?? throw new InvalidOperationException("Empty response.");
    }

    private static async Task<List<PolicyDto>> GetPoliciesAsync(HttpClient client) =>
        await client.GetFromJsonAsync<List<PolicyDto>>("/api/v1/retention", TestApi.Json, Cancellation) ?? [];

    private static async Task DeletePolicyAsync(HttpClient client, long id)
    {
        using var response = await client.DeleteAsync($"/api/v1/retention/{id}", Cancellation);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private sealed record PolicyDto(
        long Id,
        long? SignalId,
        string? SignalTitle,
        int RetentionDays,
        bool IsEnabled,
        DateTimeOffset? LastRunDate,
        long? LastDeletedCount);
}
