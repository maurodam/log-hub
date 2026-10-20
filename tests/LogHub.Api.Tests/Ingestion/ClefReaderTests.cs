using System.Text;
using System.Text.Json;
using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Tests.Ingestion;

public class ClefReaderTests
{
    private const int MaxEventBytes = 512 * 1024;

    [Fact]
    public void Reads_newline_delimited_clef_and_renders_the_message()
    {
        var payload = """
            {"@t":"2026-10-20T08:00:00.123+02:00","@mt":"User {UserId} logged in from {Ip}","UserId":42,"Ip":"10.0.0.1"}
            {"@t":"2026-10-20T08:00:01Z","@mt":"Disk full","@l":"Warning"}
            """;

        var events = ReadClef(payload);

        Assert.Equal(2, events.Count);
        var first = events[0];
        Assert.Equal(new DateTimeOffset(2026, 10, 20, 6, 0, 0, 123, TimeSpan.Zero), first.Timestamp);
        Assert.Equal("Information", first.Level);
        Assert.Equal(LogLevels.Information, first.LevelRank);
        Assert.Equal("User {UserId} logged in from {Ip}", first.MessageTemplate);
        Assert.Equal("User 42 logged in from 10.0.0.1", first.Message);
        Assert.Equal(42, Property(first, "UserId").GetInt32());
        Assert.Equal(LogLevels.Warning, events[1].LevelRank);
    }

    [Fact]
    public void Keeps_reified_properties_out_of_user_properties()
    {
        var events = ReadClef("""
            {"@t":"2026-10-20T08:00:00Z","@m":"Done","@x":"System.Exception: boom","@tr":"4bf92f3577b34da6a3ce929d0e0e4736","@sp":"00f067aa0ba902b7","@ra":{"service.name":"api"},"Custom":"x"}
            """);

        var e = Assert.Single(events);
        Assert.Equal("Done", e.Message);
        Assert.Null(e.MessageTemplate);
        Assert.Equal("System.Exception: boom", e.Exception);
        Assert.Equal("4bf92f3577b34da6a3ce929d0e0e4736", e.TraceId);
        Assert.Equal("00f067aa0ba902b7", e.SpanId);
        Assert.Equal("""{"service.name":"api"}""", e.Resource);
        Assert.Equal("""{"Custom":"x"}""", e.Properties);
    }

    [Fact]
    public void Double_at_sign_escapes_a_user_property()
    {
        var e = Assert.Single(ReadClef("""{"@t":"2026-10-20T08:00:00Z","@@Name":"value","@unknown":1}"""));

        Assert.Equal("value", Property(e, "@Name").GetString());
        Assert.Equal(1, Property(e, "@unknown").GetInt32());
    }

    [Fact]
    public void Uses_renderings_for_tokens_with_a_format()
    {
        var e = Assert.Single(ReadClef("""
            {"@t":"2026-10-20T08:00:00Z","@mt":"Disk at {Percent:0.0}% on {Drive}","Percent":91.234,"Drive":"C","@r":["91.2"]}
            """));

        Assert.Equal("Disk at 91.2% on C", e.Message);
        Assert.Equal("""["91.2"]""", e.Renderings);
    }

    [Fact]
    public void Ignores_blank_lines_and_carriage_returns()
    {
        var events = ReadClef("{\"@t\":\"2026-10-20T08:00:00Z\"}\r\n\r\n{\"@t\":\"2026-10-20T08:00:01Z\"}\r\n");

        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void Rejects_an_event_without_timestamp()
    {
        var ex = Assert.Throws<InvalidPayloadException>(() => ReadClef("""{"@mt":"No time"}"""));

        Assert.Contains("@t", ex.Message);
    }

    [Fact]
    public void Rejects_invalid_json_and_reports_the_line()
    {
        var ex = Assert.Throws<InvalidPayloadException>(() => ReadClef("""
            {"@t":"2026-10-20T08:00:00Z"}
            {not json
            """));

        Assert.Contains("Line 2", ex.Message);
    }

    [Fact]
    public void Rejects_an_event_larger_than_the_limit()
    {
        var big = new string('x', 100);
        var payload = Encoding.UTF8.GetBytes($$"""{"@t":"2026-10-20T08:00:00Z","Big":"{{big}}"}""");

        Assert.Throws<InvalidPayloadException>(() => ClefReader.Read(payload, isClef: true, maxEventBytes: 50));
    }

    [Fact]
    public void Reads_a_single_json_event_without_clef_content_type()
    {
        var payload = Encoding.UTF8.GetBytes("""{"@t":"2026-10-20T08:00:00Z","@mt":"Hello {Name}","Name":"World"}""");

        var e = Assert.Single(ClefReader.Read(payload, isClef: false, MaxEventBytes));

        Assert.Equal("Hello World", e.Message);
    }

    [Fact]
    public void Reads_the_legacy_events_format()
    {
        var payload = Encoding.UTF8.GetBytes("""
            {"Events":[
              {"Timestamp":"2026-10-20T08:00:00Z","Level":"Error","MessageTemplate":"Order {OrderId} failed","Exception":"boom",
               "Properties":{"OrderId":7},"Renderings":{"OrderId":[{"Format":"000","Rendering":"007"}]}},
              {"Timestamp":"2026-10-20T08:00:01Z","Level":"Information","MessageTemplate":"Ok"}
            ]}
            """);

        var events = ClefReader.Read(payload, isClef: false, MaxEventBytes);

        Assert.Equal(2, events.Count);
        Assert.Equal(LogLevels.Error, events[0].LevelRank);
        Assert.Equal("Order 7 failed", events[0].Message);
        Assert.Equal("boom", events[0].Exception);
        Assert.Equal(7, Property(events[0], "OrderId").GetInt32());
    }

    [Fact]
    public void Applied_properties_override_event_properties()
    {
        using var applied = JsonDocument.Parse("""{"App":"Billing","Env":"Prod"}""");
        var payload = Encoding.UTF8.GetBytes("""{"@t":"2026-10-20T08:00:00Z","App":"Spoofed","UserId":1}""");

        var e = Assert.Single(ClefReader.Read(payload, isClef: true, MaxEventBytes, applied.RootElement));

        Assert.Equal("Billing", Property(e, "App").GetString());
        Assert.Equal("Prod", Property(e, "Env").GetString());
        Assert.Equal(1, Property(e, "UserId").GetInt32());
    }

    [Fact]
    public void Event_type_is_stable_per_template_and_honours_explicit_ids()
    {
        var events = ReadClef("""
            {"@t":"2026-10-20T08:00:00Z","@mt":"User {UserId} logged in","UserId":1}
            {"@t":"2026-10-20T08:00:01Z","@mt":"User {UserId} logged in","UserId":2}
            {"@t":"2026-10-20T08:00:02Z","@mt":"Other"}
            {"@t":"2026-10-20T08:00:03Z","@i":"a1b2c3d4"}
            {"@t":"2026-10-20T08:00:04Z","@i":123}
            """);

        Assert.Equal(events[0].EventType, events[1].EventType);
        Assert.NotEqual(events[0].EventType, events[2].EventType);
        Assert.Equal(0xa1b2c3d4, events[3].EventType);
        Assert.Equal(123, events[4].EventType);
    }

    private static List<IngestedEvent> ReadClef(string payload) =>
        ClefReader.Read(Encoding.UTF8.GetBytes(payload), isClef: true, MaxEventBytes);

    private static JsonElement Property(IngestedEvent e, string name) =>
        JsonDocument.Parse(e.Properties).RootElement.GetProperty(name).Clone();
}
