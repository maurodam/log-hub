using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LogHub.Api.Common.Security;

namespace LogHub.IntegrationTests;

/// <summary>API keys, users, signals (and signal/API key event filters) and the stats overview.</summary>
[Collection(LogHubCollection.Name)]
public class AdminApiTests(LogHubFixture fixture)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Api_key_token_is_shown_once_and_works_for_ingestion()
    {
        using var admin = await fixture.CreateSessionClientAsync();

        using var created = await admin.PostAsJsonAsync("/api/v1/apikeys", new
        {
            title = "Billing",
            permissions = new[] { "Ingest" },
            minimumLevel = "warn",
            appliedProperties = new { App = "Billing" },
            useServerTimestamps = false,
        }, Ct);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var token = body.GetProperty("token").GetString()!;
        var key = body.GetProperty("apiKey");
        Assert.Equal(token[..4], key.GetProperty("tokenPrefix").GetString());
        Assert.Equal("Warning", key.GetProperty("minimumLevel").GetString());

        var list = await admin.GetStringAsync("/api/v1/apikeys", Ct);
        Assert.DoesNotContain(token, list);

        using var ingest = await IngestAsync(token, """{"@t":"2026-10-20T08:00:00Z","@l":"Error","@m":"From new key"}""");
        Assert.Equal("""{"MinimumLevelAccepted":"Warning"}""", await ingest.Content.ReadAsStringAsync(Ct));
    }

    [Fact]
    public async Task Api_key_cannot_grant_more_than_its_creator_has()
    {
        var (_, projectKey) = await fixture.CreateApiKeyAsync([Permissions.Read, Permissions.Project]);
        using var client = ApiKeyClient(projectKey);

        using var escalation = await client.PostAsJsonAsync("/api/v1/apikeys", new { title = "Too strong", permissions = new[] { "System" } }, Ct);
        using var allowed = await client.PostAsJsonAsync("/api/v1/apikeys", new { title = "Reader", permissions = new[] { "Read" } }, Ct);

        Assert.Equal(HttpStatusCode.Forbidden, escalation.StatusCode);
        Assert.Equal(HttpStatusCode.Created, allowed.StatusCode);
    }

    [Fact]
    public async Task Deleted_api_key_stops_working_immediately()
    {
        using var admin = await fixture.CreateSessionClientAsync();
        using var created = await admin.PostAsJsonAsync("/api/v1/apikeys", new { title = "Temporary", permissions = new[] { "Ingest" } }, Ct);
        var body = await created.Content.ReadFromJsonAsync<JsonElement>(Ct);
        var token = body.GetProperty("token").GetString()!;
        var id = body.GetProperty("apiKey").GetProperty("id").GetInt64();

        using var before = await IngestAsync(token, string.Empty);
        using var deleted = await admin.DeleteAsync($"/api/v1/apikeys/{id}", Ct);
        using var after = await IngestAsync(token, string.Empty);

        Assert.Equal(HttpStatusCode.Created, before.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task Users_endpoints_need_organization_permission_and_protect_the_last_admin()
    {
        var (_, readKey) = await fixture.CreateApiKeyAsync([Permissions.Read]);
        using var reader = ApiKeyClient(readKey);
        using var forbidden = await reader.GetAsync("/api/v1/users", Ct);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        using var admin = await fixture.CreateSessionClientAsync();
        var me = await admin.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct);
        var adminId = me.GetProperty("id").GetInt64();

        using var deleteSelf = await admin.DeleteAsync($"/api/v1/users/{adminId}", Ct);
        using var weakPassword = await admin.PostAsJsonAsync("/api/v1/users", new { username = "weak", password = "short", roleIds = Array.Empty<long>() }, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, deleteSelf.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, weakPassword.StatusCode);
    }

    [Fact]
    public async Task Signals_filter_events_with_or_inside_a_group_and_and_across_groups()
    {
        var run = Guid.NewGuid().ToString("N");
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        using var ingest = await IngestAsync(token,
            Clef("Info A", "Information", run, "Service=A"),
            Clef("Error A", "Error", run, "Service=A"),
            Clef("Warning B", "Warning", run, "Service=B"),
            Clef("Error B", "Error", run, "Service=B", exception: true));
        await fixture.WaitForEventsAsync(apiKeyId, 4);

        using var admin = await fixture.CreateSessionClientAsync();
        var signals = await admin.GetFromJsonAsync<JsonElement>("/api/v1/signals", Ct);
        long Builtin(string title) => signals.EnumerateArray().Single(s => s.GetProperty("title").GetString() == title).GetProperty("id").GetInt64();
        var errors = Builtin("Errors");
        var warnings = Builtin("Warnings");
        var exceptions = Builtin("Exceptions");

        using var createdSignal = await admin.PostAsJsonAsync("/api/v1/signals", new
        {
            title = $"Service B {run}",
            groupName = "Service",
            filter = new { properties = new[] { "Service=B" } },
            isShared = false,
        }, Ct);
        Assert.Equal(HttpStatusCode.Created, createdSignal.StatusCode);
        var serviceB = (await createdSignal.Content.ReadFromJsonAsync<JsonElement>(Ct)).GetProperty("id").GetInt64();

        async Task<string?[]> Messages(string query) =>
            (await admin.GetFromJsonAsync<JsonElement>($"/api/v1/events?property=Run={run}&{query}", Ct))
                .GetProperty("events").EnumerateArray().Select(e => e.GetProperty("message").GetString()).OrderBy(m => m).ToArray();

        Assert.Equal(["Error A", "Error B", "Warning B"], await Messages($"signals={errors},{warnings}"));
        Assert.Equal(["Error B", "Warning B"], await Messages($"signals={errors},{warnings},{serviceB}"));
        Assert.Equal(["Error B"], await Messages($"signals={exceptions}"));
        Assert.Equal(["Error A", "Error B", "Info A", "Warning B"], await Messages($"apiKeys={apiKeyId}"));
        Assert.Equal(["Error B"], await Messages("hasException=true"));

        using var protectedDelete = await admin.DeleteAsync($"/api/v1/signals/{errors}", Ct);
        Assert.Equal(HttpStatusCode.BadRequest, protectedDelete.StatusCode);
    }

    [Fact]
    public async Task Stats_overview_counts_events_by_bucket_level_type_and_api_key()
    {
        var run = Guid.NewGuid().ToString("N");
        var (apiKeyId, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        using var ingest = await IngestAsync(token,
            Clef("Same template", "Information", run, at: "2026-10-20T08:01:00Z"),
            Clef("Same template", "Information", run, at: "2026-10-20T08:02:00Z"),
            Clef("Broken", "Error", run, at: "2026-10-20T09:30:00Z", exception: true));
        await fixture.WaitForEventsAsync(apiKeyId, 3);

        using var admin = await fixture.CreateSessionClientAsync();
        var overview = await admin.GetFromJsonAsync<JsonElement>(
            $"/api/v1/stats/overview?property=Run={run}&from=2026-10-20T08:00:00Z&to=2026-10-20T10:00:00Z&bucket=3600", Ct);

        Assert.Equal(3, overview.GetProperty("total").GetInt64());
        Assert.Equal(1, overview.GetProperty("errors").GetInt64());
        Assert.Equal(1, overview.GetProperty("exceptions").GetInt64());
        Assert.Equal(2, overview.GetProperty("distinctEventTypes").GetInt64());
        Assert.Equal([2L, 1L], overview.GetProperty("series").EnumerateArray().Select(p => p.GetProperty("total").GetInt64()).ToArray());
        Assert.Equal(2, overview.GetProperty("topEventTypes")[0].GetProperty("count").GetInt64());
        Assert.Equal(apiKeyId, overview.GetProperty("apiKeys")[0].GetProperty("apiKeyId").GetInt64());

        var eventType = overview.GetProperty("topEventTypes")[0].GetProperty("eventType").GetString();
        var byType = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/events?property=Run={run}&eventType={Uri.EscapeDataString(eventType!)}", Ct);
        Assert.Equal(2, byType.GetProperty("events").GetArrayLength());
    }

    private HttpClient ApiKeyClient(string token)
    {
        var client = fixture.Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", token);
        return client;
    }

    private async Task<HttpResponseMessage> IngestAsync(string token, params string[] lines)
    {
        using var client = fixture.Factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(string.Join('\n', lines), Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-Seq-ApiKey", token);
        return await client.SendAsync(request, Ct);
    }

    private static string Clef(string message, string level, string run, string? property = null, string at = "2026-10-20T08:00:00Z", bool exception = false)
    {
        var extra = property is null ? "" : $",\"{property.Split('=')[0]}\":\"{property.Split('=')[1]}\"";
        var ex = exception ? ",\"@x\":\"System.Exception: boom\"" : "";
        return $$"""{"@t":"{{at}}","@mt":"{{message}}","@l":"{{level}}","Run":"{{run}}"{{extra}}{{ex}}}""";
    }
}
