using System.Data.Common;
using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Npgsql;

namespace LogHub.Api.Features.Retention;

/// <summary>A partition of event. Rows is the planner estimate (pg_class.reltuples, 0 when unknown).</summary>
public sealed record EventPartition(string Name, DateTime? From, DateTime? To, long Rows, long Bytes);

public sealed record StorageInfo(long TotalEvents, long TotalBytes, DateTime? OldestEvent, IReadOnlyList<EventPartition> Partitions);

/// <summary>Daily partitions of event: event_yyyymmdd covers one UTC day; event_default catches the rest.</summary>
public static partial class EventPartitions
{
    public const string DefaultPartition = "event_default";

    public static string Name(DateOnly day) => "event_" + day.ToString("yyyyMMdd", CultureInfo.InvariantCulture);

    /// <summary>True for the daily partitions managed by LogHub (only these are ever dropped).</summary>
    public static bool IsDaily(string name) => DailyName().IsMatch(name);

    /// <summary>Partitions of event with their bounds (null for the default partition), estimated rows and size.</summary>
    public static async Task<List<EventPartition>> ListAsync(DbConnection connection, CancellationToken cancellationToken) =>
        (await connection.QueryAsync<EventPartition>(new CommandDefinition(
            """
            select c.relname::text as name,
                   (regexp_match(pg_get_expr(c.relpartbound, c.oid), $$FROM \('([^']+)'\)$$))[1]::timestamptz as from,
                   (regexp_match(pg_get_expr(c.relpartbound, c.oid), $$TO \('([^']+)'\)$$))[1]::timestamptz as to,
                   greatest(c.reltuples, 0)::bigint as rows,
                   pg_total_relation_size(c.oid) as bytes
            from pg_inherits i
            join pg_class c on c.oid = i.inhrelid
            where i.inhparent = 'event'::regclass
            order by 2 nulls last, 1
            """,
            cancellationToken: cancellationToken))).AsList();

    [GeneratedRegex(@"^event_\d{8}$", RegexOptions.CultureInvariant)]
    private static partial Regex DailyName();
}

/// <summary>GET /api/v1/retention/storage: event count and size per partition (estimates), oldest event.</summary>
public static class RetentionStorage
{
    public static async Task<IResult> Handle(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var partitions = await EventPartitions.ListAsync(connection, cancellationToken);

        // min() on the partitioned table becomes one backward probe of ix_event_timestamp_id per partition.
        var oldestEvent = await connection.ExecuteScalarAsync<DateTime?>(new CommandDefinition(
            """select min(timestamp) from event """, cancellationToken: cancellationToken));

        return Results.Ok(new StorageInfo(
            partitions.Sum(p => p.Rows),
            partitions.Sum(p => p.Bytes),
            oldestEvent,
            partitions));
    }
}
