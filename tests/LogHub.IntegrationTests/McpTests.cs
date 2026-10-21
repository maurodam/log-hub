using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LogHub.Api.Common.Security;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace LogHub.IntegrationTests;

[Collection(LogHubCollection.Name)]
public sealed class McpTests(LogHubFixture fixture)
{
    [Fact]
    public async Task Requires_read_api_key_and_rejects_session_cookie()
    {
        using var anonymous = fixture.Factory.CreateClient();
        using var response = await anonymous.PostAsync("/mcp", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("\"error\"", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);
        anonymous.DefaultRequestHeaders.Add("X-Api-Key", token);
        using var forbidden = await anonymous.PostAsync("/mcp", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        using var session = await fixture.CreateSessionClientAsync();
        using var cookieOnly = await session.PostAsync("/mcp", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, cookieOnly.StatusCode);
    }

    [Fact]
    public async Task Lists_only_four_read_only_tools()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);
        using var http = fixture.Factory.CreateClient();
        await using var client = await ConnectAsync(http, token);
        var tools = await client.ListToolsAsync(cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(["get_event", "get_stats_overview", "list_signals", "search_events"], tools.Select(t => t.Name).Order().ToArray());
        Assert.All(tools, tool => Assert.True(tool.ProtocolTool.Annotations?.ReadOnlyHint));
    }

    [Fact]
    public async Task Searches_pages_gets_details_and_reports_input_errors()
    {
        var (keyId, token) = await fixture.CreateApiKeyAsync([Permissions.Read, Permissions.Ingest]);
        var run = Guid.NewGuid().ToString("N");
        var longMessage = new string('x', 1500);
        using var http = fixture.Factory.CreateClient();
        http.DefaultRequestHeaders.Add("X-Seq-ApiKey", token);
        var lines = Enumerable.Range(1, 3).Select(i => JsonSerializer.Serialize(new Dictionary<string, object>
        {
            ["@t"] = $"2026-10-20T08:00:0{i}Z", ["@m"] = i == 3 ? longMessage : $"Event {i}",
            ["@l"] = i == 1 ? "Information" : "Error", ["Run"] = run,
        }));
        using var content = new StringContent(string.Join('\n', lines), Encoding.UTF8, "application/vnd.serilog.clef");
        using var ingested = await http.PostAsync("/api/events/raw", content, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, ingested.StatusCode);
        Assert.Equal(3, (await fixture.WaitForEventsAsync(keyId, 3)).Count);
        await using var client = await ConnectAsync(http, token);
        var arguments = new Dictionary<string, object?> { ["properties"] = new[] { $"Run={run}" }, ["levels"] = new[] { "Error" }, ["count"] = 1 };
        var first = Data(await CallAsync(client, "search_events", arguments));
        var item = Assert.Single(first.GetProperty("events").EnumerateArray());
        Assert.EndsWith("… [truncated 500 chars]", item.GetProperty("message").GetString());
        var id = item.GetProperty("id").GetInt64();
        arguments["cursor"] = first.GetProperty("nextCursor").GetString();
        var second = Data(await CallAsync(client, "search_events", arguments));
        Assert.Equal("Event 2", Assert.Single(second.GetProperty("events").EnumerateArray()).GetProperty("message").GetString());
        Assert.Equal(JsonValueKind.Null, second.GetProperty("nextCursor").ValueKind);
        var detail = Data(await CallAsync(client, "get_event", new() { ["id"] = id }));
        Assert.Equal(longMessage, detail.GetProperty("message").GetString());
        Assert.True((await CallAsync(client, "get_event", new() { ["id"] = long.MaxValue })).IsError);
        arguments["cursor"] = "invalid";
        var invalid = await CallAsync(client, "search_events", arguments);
        Assert.True(invalid.IsError);
        Assert.Contains("cursor", ((TextContentBlock)Assert.Single(invalid.Content)).Text);
        Assert.True((await CallAsync(client, "get_stats_overview", new()
        {
            ["from"] = "2026-10-21T00:00:00Z", ["to"] = "2026-10-20T00:00:00Z",
        })).IsError);
        var stats = Data(await CallAsync(client, "get_stats_overview", new()
        {
            ["properties"] = new[] { $"Run={run}" }, ["from"] = "2026-10-20T08:00:00Z", ["to"] = "2026-10-20T09:00:00Z",
        }));
        Assert.Equal(3, stats.GetProperty("total").GetInt64());
    }

    [Fact]
    public async Task Api_keys_only_see_shared_signals()
    {
        using var session = await fixture.CreateSessionClientAsync();
        var title = Guid.NewGuid().ToString("N");
        var ids = new List<long>();
        try
        {
            foreach (var shared in new[] { false, true })
            {
                using var created = await session.PostAsJsonAsync("/api/v1/signals/", new
                {
                    title = title + shared, isShared = shared, filter = new { },
                }, TestContext.Current.CancellationToken);
                created.EnsureSuccessStatusCode();
                var signal = await created.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
                ids.Add(signal.GetProperty("id").GetInt64());
            }

            var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);
            using var http = fixture.Factory.CreateClient();
            await using var client = await ConnectAsync(http, token);
            var signals = Data(await CallAsync(client, "list_signals", new()));
            Assert.All(signals.EnumerateArray(), s => Assert.True(s.GetProperty("isShared").GetBoolean()));
            Assert.Contains(signals.EnumerateArray(), s => s.GetProperty("id").GetInt64() == ids[1]);
            Assert.DoesNotContain(signals.EnumerateArray(), s => s.GetProperty("id").GetInt64() == ids[0]);
            Assert.True((await CallAsync(client, "search_events", new() { ["signalIds"] = new[] { ids[0] } })).IsError);
        }
        finally
        {
            foreach (var id in ids)
            {
                using var deleted = await session.DeleteAsync($"/api/v1/signals/{id}", TestContext.Current.CancellationToken);
                deleted.EnsureSuccessStatusCode();
            }
        }
    }

    private static async Task<McpClient> ConnectAsync(HttpClient http, string token) =>
        await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = new Uri(http.BaseAddress!, "/mcp"),
            AdditionalHeaders = new Dictionary<string, string> { ["X-Api-Key"] = token },
        }, http), cancellationToken: TestContext.Current.CancellationToken);

    private static ValueTask<CallToolResult> CallAsync(McpClient client, string name, Dictionary<string, object?> arguments) =>
        client.CallToolAsync(name, arguments, cancellationToken: TestContext.Current.CancellationToken);

    private static JsonElement Data(CallToolResult result)
    {
        Assert.False(result.IsError);
        return JsonSerializer.Deserialize<JsonElement>(((TextContentBlock)Assert.Single(result.Content)).Text);
    }
}
