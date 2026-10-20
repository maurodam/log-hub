using System.Globalization;
using System.Text.Json;

namespace LogHub.Api.Features.Events;

/// <summary>Event as returned by /api/v1/events (camelCase JSON).</summary>
public sealed record LogEventDto(
    long Id,
    DateTimeOffset Timestamp,
    DateTimeOffset Arrived,
    string Level,
    short LevelRank,
    string? MessageTemplate,
    string? Message,
    string? Exception,
    string EventType,
    string? TraceId,
    string? SpanId,
    long? ApiKeyId,
    JsonElement Properties);

/// <summary>Row read by Dapper from the event table.</summary>
public sealed class EventRow
{
    public const string SelectColumns = """
        select id, timestamp, arrived, level, level_rank, message_template, message, exception,
               event_type, trace_id, span_id, api_key_id, properties::text as properties
        from event
        """;

    public long Id { get; init; }

    public DateTime Timestamp { get; init; }

    public DateTime Arrived { get; init; }

    public string Level { get; init; } = string.Empty;

    public short LevelRank { get; init; }

    public string? MessageTemplate { get; init; }

    public string? Message { get; init; }

    public string? Exception { get; init; }

    public long EventType { get; init; }

    public string? TraceId { get; init; }

    public string? SpanId { get; init; }

    public long? ApiKeyId { get; init; }

    public string Properties { get; init; } = "{}";

    public LogEventDto ToDto() => new(
        Id,
        new DateTimeOffset(DateTime.SpecifyKind(Timestamp, DateTimeKind.Utc)),
        new DateTimeOffset(DateTime.SpecifyKind(Arrived, DateTimeKind.Utc)),
        Level,
        LevelRank,
        MessageTemplate,
        Message,
        Exception,
        "$" + ((uint)EventType).ToString("X8", CultureInfo.InvariantCulture),
        TraceId,
        SpanId,
        ApiKeyId,
        JsonSerializer.Deserialize<JsonElement>(Properties));
}
