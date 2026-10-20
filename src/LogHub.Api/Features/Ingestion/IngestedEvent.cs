namespace LogHub.Api.Features.Ingestion;

/// <summary>One parsed event, ready to be written to the event table. JSON columns hold raw JSON text.</summary>
public sealed record IngestedEvent(
    DateTimeOffset Timestamp,
    string Level,
    short LevelRank,
    string? MessageTemplate,
    string? Message,
    string? Exception,
    long EventType,
    string? TraceId,
    string? SpanId,
    string? ParentSpanId,
    string? SpanKind,
    DateTimeOffset? SpanStart,
    string Properties,
    string? Renderings,
    string? Resource,
    string? Scope);

/// <summary>The events of one ingestion request.</summary>
public sealed record IngestionBatch(long? ApiKeyId, DateTimeOffset Arrived, IReadOnlyList<IngestedEvent> Events);

public sealed class InvalidPayloadException(string message) : Exception(message);
