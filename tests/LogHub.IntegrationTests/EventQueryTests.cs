using System.Net;
using System.Net.Http.Json;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Events;

namespace LogHub.IntegrationTests;

[Collection(LogHubCollection.Name)]
public class EventQueryTests(LogHubFixture fixture)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Aggregates_typed_properties_and_saves_shared_widgets()
    {
        using var reader = await fixture.CreateApiClientAsync(Permissions.Read);
        using var editor = await fixture.CreateApiClientAsync(Permissions.Read, Permissions.Project);
        var marker = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        await fixture.IngestAsync(token,
            $$$"""{"@t":"{{{now:O}}}","@l":"Error","@x":"test-exception-{{{marker}}}","Run":"{{{marker}}}","Http":{"Ms":42}}""",
            $$$"""{"@t":"{{{now:O}}}","@l":"Error","Run":"{{{marker}}}","Http":{"Ms":"wrong type"}}""");
        var query = $"WHERE properties.Run = '{marker}' AND level >= 'Error' GROUP BY bucket('1h') SELECT avg(properties.Http.Ms)";
        using var aggregate = await reader.PostAsJsonAsync("/api/v1/events/query", new EventQueryInput(query, now.AddHours(-1), now.AddMinutes(1)), Ct);
        Assert.Equal(HttpStatusCode.OK, aggregate.StatusCode);
        var group = Assert.Single((await aggregate.ReadJsonAsync()).GetProperty("groups").EnumerateArray());
        Assert.Equal(42m, group.GetProperty("value").GetDecimal());

        using var events = await reader.PostAsJsonAsync("/api/v1/events/query",
            new EventQueryInput($"WHERE exception CONTAINS '{marker}'", now.AddHours(-1), now.AddMinutes(1)), Ct);
        Assert.Equal(HttpStatusCode.OK, events.StatusCode);
        Assert.Single((await events.ReadJsonAsync()).GetProperty("events").EnumerateArray());

        var dashboard = new DashboardInput(marker, [new("Request time", query, 24, "series")], 0);
        using var denied = await reader.PostAsJsonAsync("/api/v1/dashboards", dashboard, Ct);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var created = await editor.PostAsJsonAsync("/api/v1/dashboards", dashboard, Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.ReadJsonAsync()).GetProperty("id").GetInt64();
        using var list = await reader.GetAsync("/api/v1/dashboards", Ct);
        var item = Assert.Single((await list.ReadJsonAsync()).EnumerateArray(), entry => entry.GetProperty("id").GetInt64() == id);
        Assert.Equal(query, item.GetProperty("widgets")[0].GetProperty("expression").GetString());

        using var stale = await editor.PutAsJsonAsync($"/api/v1/dashboards/{id}", dashboard, Ct);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var deleted = await editor.DeleteAsync($"/api/v1/dashboards/{id}?revision=1", Ct);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    }
}
