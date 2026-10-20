using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Retention;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace LogHub.IntegrationTests;

/// <summary>Retention:DefaultDays creates or updates the all-events policy.</summary>
[Collection(LogHubCollection.Name)]
public class RetentionDefaultsTests(LogHubFixture fixture)
{
    [Fact]
    public async Task Default_days_upsert_the_all_events_policy()
    {
        var dataSource = fixture.Factory.Services.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(TestContext.Current.CancellationToken);
        await connection.ExecuteAsync("""delete from retention where signal_id is null""");

        try
        {
            await RetentionDefaults.ApplyAsync(dataSource, 180, TestContext.Current.CancellationToken);
            await RetentionDefaults.ApplyAsync(dataSource, 365, TestContext.Current.CancellationToken);

            var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read, Permissions.Project]);
            using var client = fixture.Factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Api-Key", token);
            var policies = await client.GetFromJsonAsync<JsonElement>("/api/v1/retention", TestContext.Current.CancellationToken);
            var allEvents = policies.EnumerateArray().Single(p => p.GetProperty("signalId").ValueKind == JsonValueKind.Null);

            Assert.Equal(365, allEvents.GetProperty("retentionDays").GetInt32());
            Assert.True(allEvents.GetProperty("isEnabled").GetBoolean());
            Assert.False(allEvents.GetProperty("isManagedByEnvironment").GetBoolean());
        }
        finally
        {
            await connection.ExecuteAsync("""delete from retention where signal_id is null""");
        }
    }
}
