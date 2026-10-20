using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Features.Events;

/// <summary>A signal as used by filters: its group and its filter.</summary>
public sealed record SignalDefinition(long Id, string? GroupName, FilterSpec Filter);

/// <summary>
/// Translates filters to a parameterized SQL WHERE clause on event.
/// Free text (message or exception, case-insensitive), levels, trace id, exact top-level property values
/// (JSON containment, served by the GIN index), API keys, exceptions, time range and signals.
/// Invalid input throws <see cref="FilterException"/>.
/// </summary>
public sealed class EventFilter
{
    private readonly List<string> conditions = [];
    private int parameterCount;

    public DynamicParameters Parameters { get; } = new();

    /// <summary>Adds a parameter with a unique name and returns its placeholder ("@p3").</summary>
    public string Parameter(object? value)
    {
        var name = $"p{parameterCount++}";
        Parameters.Add(name, value);
        return "@" + name;
    }

    public EventFilter Where(string condition)
    {
        conditions.Add(condition);
        return this;
    }

    public EventFilter AddSpec(FilterSpec spec)
    {
        if (Compile(spec) is { } condition)
        {
            Where(condition);
        }

        return this;
    }

    public EventFilter AddTimeRange(DateTimeOffset? from, DateTimeOffset? to)
    {
        if (from is { } start)
        {
            Where($"""
                timestamp >= {Parameter(start.UtcDateTime)}
                """.Trim());
        }

        if (to is { } end)
        {
            Where($"""
                timestamp < {Parameter(end.UtcDateTime)}
                """.Trim());
        }

        return this;
    }

    /// <summary>Signals in the same group combine with OR; groups (and ungrouped signals) combine with AND.</summary>
    public EventFilter AddSignals(IEnumerable<SignalDefinition> signals)
    {
        foreach (var group in signals.GroupBy(s => string.IsNullOrWhiteSpace(s.GroupName) ? $"#{s.Id}" : s.GroupName))
        {
            var alternatives = group.Select(s => Compile(s.Filter) ?? "true").ToList();
            Where(alternatives.Count == 1 ? alternatives[0] : $"({string.Join(" or ", alternatives)})");
        }

        return this;
    }

    /// <summary>The SQL condition for a spec, or null when the spec filters nothing.</summary>
    public string? Compile(FilterSpec spec)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(spec.Text))
        {
            var pattern = Parameter($"%{EscapeLike(spec.Text.Trim())}%");
            parts.Add($"""(message ilike {pattern} or exception ilike {pattern})""");
        }

        if (spec.Levels is { Length: > 0 } levels)
        {
            var ranks = levels
                .Select(name => LogLevels.TryRank(name) ?? throw new FilterException($"Unknown level '{name}'."))
                .Distinct()
                .ToArray();
            parts.Add($"level_rank = any({Parameter(ranks)})");
        }

        foreach (var property in spec.Properties ?? [])
        {
            var separator = property.IndexOf('=');
            if (separator <= 0)
            {
                throw new FilterException($"Property filter '{property}' must look like Name=Value.");
            }

            var containment = new JsonObject { [property[..separator]] = ParseValue(property[(separator + 1)..]) };
            parts.Add($"properties @> {Parameter(containment.ToJsonString())}::jsonb");
        }

        if (spec.ApiKeyIds is { Length: > 0 } apiKeyIds)
        {
            parts.Add($"api_key_id = any({Parameter(apiKeyIds)})");
        }

        if (spec.HasException is { } hasException)
        {
            parts.Add(hasException ? "exception is not null" : "exception is null");
        }

        if (!string.IsNullOrWhiteSpace(spec.TraceId))
        {
            parts.Add($"trace_id = {Parameter(spec.TraceId.Trim())}");
        }

        if (!string.IsNullOrWhiteSpace(spec.EventType))
        {
            var hex = spec.EventType.Trim().TrimStart('$');
            if (!uint.TryParse(hex, System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var eventType))
            {
                throw new FilterException($"'{spec.EventType}' is not a valid event type.");
            }

            parts.Add($"event_type = {Parameter((long)eventType)}");
        }

        return parts.Count switch
        {
            0 => null,
            1 => parts[0],
            _ => $"({string.Join(" and ", parts)})",
        };
    }

    /// <summary>Appends " where ..." (or nothing) to the SQL.</summary>
    public void AppendWhere(StringBuilder sql)
    {
        if (conditions.Count > 0)
        {
            sql.Append(" where ").AppendJoin(" and ", conditions);
        }
    }

    public string WhereClause()
    {
        var sql = new StringBuilder();
        AppendWhere(sql);
        return sql.ToString();
    }

    /// <summary>42, true, null and other JSON literals keep their type; anything else is a string.</summary>
    private static JsonNode? ParseValue(string value)
    {
        try
        {
            return JsonNode.Parse(value);
        }
        catch (JsonException)
        {
            return JsonValue.Create(value);
        }
    }

    private static string EscapeLike(string text) =>
        text.Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_");
}
