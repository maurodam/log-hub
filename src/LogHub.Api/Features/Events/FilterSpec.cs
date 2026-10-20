using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace LogHub.Api.Features.Events;

/// <summary>
/// Structured event filter. Stored as JSON by signals and alerts; built from the query string by the events and stats endpoints.
/// See docs/api/v1.md (FilterSpec).
/// </summary>
public sealed record FilterSpec(
    string? Text = null,
    string[]? Levels = null,
    string[]? Properties = null,
    long[]? ApiKeyIds = null,
    bool? HasException = null,
    string? TraceId = null,
    string? EventType = null)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static FilterSpec FromJson(string? json) =>
        string.IsNullOrWhiteSpace(json) ? new FilterSpec() : JsonSerializer.Deserialize<FilterSpec>(json, Json) ?? new FilterSpec();

    public string ToJson() => JsonSerializer.Serialize(this, Json);
}

/// <summary>Invalid filter input; endpoints answer 400 with the message.</summary>
public sealed class FilterException(string message) : Exception(message);

/// <summary>Query string shared by the events and stats endpoints.</summary>
public sealed record EventQuery(
    [FromQuery] string? Text,
    [FromQuery] string? Levels,
    [FromQuery] DateTimeOffset? From,
    [FromQuery] DateTimeOffset? To,
    [FromQuery] string? TraceId,
    [FromQuery] string[]? Property,
    [FromQuery] string? ApiKeys,
    [FromQuery] bool? HasException,
    [FromQuery] string? Signals,
    [FromQuery] string? EventType)
{
    public FilterSpec ToSpec() => new(
        Text,
        SplitList(Levels),
        Property is { Length: > 0 } ? Property : null,
        ParseIds(ApiKeys, "apiKeys"),
        HasException,
        TraceId,
        EventType);

    public long[] SignalIds() => ParseIds(Signals, "signals") ?? [];

    private static string[]? SplitList(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static long[]? ParseIds(string? value, string name) =>
        SplitList(value)?.Select(item => long.TryParse(item, NumberStyles.None, CultureInfo.InvariantCulture, out var id)
            ? id
            : throw new FilterException($"'{item}' is not a valid id in {name}.")).ToArray();
}
