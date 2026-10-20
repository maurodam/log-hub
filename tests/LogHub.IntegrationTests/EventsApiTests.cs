using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LogHub.Api.Common.Security;

namespace LogHub.IntegrationTests;

/// <summary>/api/v1/events: paging, filters, API key authorization and the SSE live tail.</summary>
[Collection(LogHubCollection.Name)]
public class EventsApiTests(LogHubFixture fixture)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Lists_newest_first_with_keyset_paging()
    {
        var (token, run) = await SeedAsync(
            Clef("2026-10-20T08:00:01Z", "First"),
            Clef("2026-10-20T08:00:02Z", "Second"),
            Clef("2026-10-20T08:00:03Z", "Third"),
            Clef("2026-10-20T08:00:04Z", "Fourth"),
            Clef("2026-10-20T08:00:05Z", "Fifth"));

        var messages = new List<string?>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var page = await GetPageAsync(token, $"property=Run={run}&count=2" + (cursor is null ? "" : $"&cursor={cursor}"));
            messages.AddRange(page.Events.Select(e => e.Message));
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null);

        Assert.Equal(["Fifth", "Fourth", "Third", "Second", "First"], messages);
        Assert.Equal(3, pages);
    }

    [Fact]
    public async Task Applies_text_level_time_trace_and_property_filters()
    {
        var (token, run) = await SeedAsync(
            Clef("2026-10-20T08:00:01Z", "Payment accepted", extra: """ "Amount":10 """),
            Clef("2026-10-20T08:00:02Z", "Payment REJECTED", level: "Error", extra: """ "Amount":20 """),
            Clef("2026-10-20T08:00:03Z", "Disk 100% full", level: "warn", extra: """ "@tr":"trace-1" """),
            Clef("2026-10-20T09:00:00Z", "Later event"));

        async Task<string?[]> Messages(string filter) =>
            (await GetPageAsync(token, $"property=Run={run}&{filter}")).Events.Select(e => e.Message).ToArray();

        Assert.Equal(["Payment REJECTED", "Payment accepted"], await Messages("text=payment"));
        Assert.Equal(["Disk 100% full"], await Messages("text=100%25"));
        Assert.Equal(["Disk 100% full", "Payment REJECTED"], await Messages("levels=Warning,Error"));
        Assert.Equal(["Payment accepted"], await Messages("property=Amount=10"));
        Assert.Equal(["Disk 100% full"], await Messages("traceId=trace-1"));
        Assert.Equal(["Disk 100% full", "Payment REJECTED"], await Messages("from=2026-10-20T08:00:02Z&to=2026-10-20T09:00:00Z"));
    }

    [Fact]
    public async Task Gets_one_event_by_id()
    {
        var (token, run) = await SeedAsync(Clef("2026-10-20T08:00:00Z", "Only one", extra: """ "Answer":42 """));
        var listed = Assert.Single((await GetPageAsync(token, $"property=Run={run}")).Events);

        using var client = CreateClient(token);
        var single = await client.GetFromJsonAsync<EventDto>($"/api/v1/events/{listed.Id}", Json, TestContext.Current.CancellationToken);
        using var missing = await client.GetAsync("/api/v1/events/999999999", TestContext.Current.CancellationToken);

        Assert.NotNull(single);
        Assert.Equal("Only one", single.Message);
        Assert.Equal(42, single.Properties.GetProperty("Answer").GetInt32());
        Assert.StartsWith("$", single.EventType);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Requires_an_api_key_with_read_permission()
    {
        var (_, ingestOnly) = await fixture.CreateApiKeyAsync([Permissions.Ingest]);

        using var anonymous = await CreateClient(token: null).GetAsync("/api/v1/events", TestContext.Current.CancellationToken);
        using var wrongKey = await CreateClient("not-a-key").GetAsync("/api/v1/events", TestContext.Current.CancellationToken);
        using var forbidden = await CreateClient(ingestOnly).GetAsync("/api/v1/events", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongKey.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.Contains("\"error\"", await forbidden.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Rejects_invalid_filters()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);
        using var client = CreateClient(token);

        using var level = await client.GetAsync("/api/v1/events?levels=Loud", TestContext.Current.CancellationToken);
        using var cursor = await client.GetAsync("/api/v1/events?cursor=garbage", TestContext.Current.CancellationToken);
        using var property = await client.GetAsync("/api/v1/events?property=NoEquals", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, level.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, cursor.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, property.StatusCode);
    }

    [Fact]
    public async Task Stream_resumes_after_last_event_id_and_pushes_new_events()
    {
        var (token, run) = await SeedAsync(Clef("2026-10-20T08:00:00Z", "Before connect"));
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));

        using var client = CreateClient(token: null);
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/v1/events/stream?property=Run={run}&apiKey={token}");
        request.Headers.Add("Last-Event-ID", "0");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);

        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(timeout.Token));
        var first = await ReadLogEventAsync(reader, timeout.Token);
        Assert.Equal("Before connect", first.Message);

        await IngestAsync(token, Clef("2026-10-20T08:00:01Z", "While connected")(run));
        var second = await ReadLogEventAsync(reader, timeout.Token);
        Assert.Equal("While connected", second.Message);
    }

    [Fact]
    public async Task Api_key_in_query_string_works_only_for_the_stream()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);
        using var client = CreateClient(token: null);

        using var response = await client.GetAsync($"/api/v1/events?apiKey={token}", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Open_streams_per_user_are_limited()
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Read]);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var open = new List<HttpResponseMessage>();
        try
        {
            for (var i = 0; i < 5; i++)
            {
                open.Add(await CreateClient(token).GetAsync("/api/v1/events/stream", HttpCompletionOption.ResponseHeadersRead, timeout.Token));
                Assert.Equal(HttpStatusCode.OK, open[^1].StatusCode);
            }

            using var sixth = await CreateClient(token).GetAsync("/api/v1/events/stream", HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            Assert.Equal(HttpStatusCode.TooManyRequests, sixth.StatusCode);
        }
        finally
        {
            open.ForEach(response => response.Dispose());
        }
    }

    private async Task<(string Token, string Run)> SeedAsync(params Func<string, string>[] events)
    {
        var (_, token) = await fixture.CreateApiKeyAsync([Permissions.Ingest, Permissions.Read]);
        var run = Guid.NewGuid().ToString("N");
        await IngestAsync(token, events.Select(e => e(run)).ToArray());

        var deadline = DateTime.UtcNow.AddSeconds(10);
        while ((await GetPageAsync(token, $"property=Run={run}&count=1000")).Events.Count < events.Length && DateTime.UtcNow < deadline)
        {
            await Task.Delay(100, TestContext.Current.CancellationToken);
        }

        return (token, run);
    }

    private async Task IngestAsync(string token, params string[] clefLines)
    {
        using var client = CreateClient(token: null);
        using var content = new StringContent(string.Join('\n', clefLines), Encoding.UTF8, "application/vnd.serilog.clef");
        content.Headers.Add("X-Seq-ApiKey", token);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw") { Content = content };
        request.Headers.Add("X-Seq-ApiKey", token);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static Func<string, string> Clef(string timestamp, string message, string level = "Information", string extra = "") =>
        run => $$"""{"@t":"{{timestamp}}","@m":"{{message}}","@l":"{{level}}","Run":"{{run}}"{{(extra.Length > 0 ? "," + extra.Trim() : "")}}}""";

    private async Task<PageDto> GetPageAsync(string token, string query)
    {
        using var client = CreateClient(token);
        var page = await client.GetFromJsonAsync<PageDto>($"/api/v1/events?{query}", Json, TestContext.Current.CancellationToken);
        return page ?? throw new InvalidOperationException("Empty response.");
    }

    private HttpClient CreateClient(string? token)
    {
        var client = fixture.Factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Add("X-Api-Key", token);
        }

        return client;
    }

    private static async Task<EventDto> ReadLogEventAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        string? eventType = null;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (line.StartsWith("event: ", StringComparison.Ordinal))
            {
                eventType = line["event: ".Length..];
            }
            else if (line.StartsWith("data: ", StringComparison.Ordinal) && eventType == "log")
            {
                return JsonSerializer.Deserialize<EventDto>(line["data: ".Length..], Json)
                    ?? throw new InvalidOperationException("Empty event.");
            }
        }

        throw new InvalidOperationException("The stream ended.");
    }

    private sealed record PageDto(List<EventDto> Events, string? NextCursor);

    private sealed record EventDto(long Id, DateTimeOffset Timestamp, string Level, int LevelRank, string? Message, string EventType, JsonElement Properties);
}
