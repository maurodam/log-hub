using System.Globalization;
using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Events;
using LogHub.Api.Features.Ingestion;
using Npgsql;

namespace LogHub.Api.Features.Stats;

public sealed record SeriesPoint(DateTimeOffset Start, long Total, long Errors, long Warnings);

public sealed record LevelCount(string Level, short LevelRank, long Count);

public sealed record EventTypeCount(string EventType, string? MessageTemplate, short LevelRank, long Count);

public sealed record ApiKeyCount(long? ApiKeyId, string? Title, long Count);

public sealed record Overview(
    DateTimeOffset From,
    DateTimeOffset To,
    int BucketSeconds,
    long Total,
    long Errors,
    long Warnings,
    long Exceptions,
    long DistinctEventTypes,
    IReadOnlyList<SeriesPoint> Series,
    IReadOnlyList<LevelCount> Levels,
    IReadOnlyList<EventTypeCount> TopEventTypes,
    IReadOnlyList<ApiKeyCount> ApiKeys);

/// <summary>GET /api/v1/stats/overview: dashboard aggregates for a time range and the usual event filters.</summary>
public static class StatsFeature
{
    private static readonly int[] NiceBuckets = [60, 300, 900, 1800, 3600, 10800, 21600, 43200, 86400, 604800];
    private static readonly DateTime Origin = new(2000, 1, 3, 0, 0, 0, DateTimeKind.Utc); // a Monday: weekly buckets start on Monday
    private const int MaxBuckets = 2000;

    public static RouteGroupBuilder MapStats(this RouteGroupBuilder api)
    {
        api.MapGet("/stats/overview", GetOverview).RequireAuthorization(Policies.Read);
        return api;
    }

    private static async Task<IResult> GetOverview(
        [AsParameters] EventQuery query,
        int? bucket,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        var to = query.To ?? DateTimeOffset.UtcNow;
        var from = query.From ?? to.AddHours(-24);
        if (from >= to)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "'from' must be earlier than 'to'.");
        }

        var span = (to - from).TotalSeconds;
        var bucketSeconds = bucket is > 0 ? bucket.Value : NiceBuckets.FirstOrDefault(b => b >= span / 60, NiceBuckets[^1]);
        if (span / bucketSeconds > MaxBuckets)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, $"The bucket is too small for this range (max {MaxBuckets} buckets).");
        }

        EventFilter filter;
        try
        {
            filter = await filters.BuildAsync(query with { From = from, To = to }, includeTimeRange: true, user, cancellationToken);
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }

        var where = filter.WhereClause();
        var interval = TimeSpan.FromSeconds(bucketSeconds);
        var parameters = new DynamicParameters(filter.Parameters);
        parameters.Add("bucketInterval", interval);
        parameters.Add("bucketOrigin", Origin);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var totals = await connection.QuerySingleAsync<(long Total, long Errors, long Warnings, long Exceptions, long DistinctEventTypes)>(
            new CommandDefinition(
                $"""
                select count(*), count(*) filter (where level_rank >= 4), count(*) filter (where level_rank = 3),
                       count(*) filter (where exception is not null), count(distinct event_type)
                from event{where}
                """,
                parameters,
                cancellationToken: cancellationToken));

        var buckets = (await connection.QueryAsync<(DateTime Start, long Total, long Errors, long Warnings)>(new CommandDefinition(
            $"""
            select date_bin(@bucketInterval, timestamp, @bucketOrigin), count(*),
                   count(*) filter (where level_rank >= 4), count(*) filter (where level_rank = 3)
            from event{where}
            group by 1
            """,
            parameters,
            cancellationToken: cancellationToken))).ToDictionary(b => DateTime.SpecifyKind(b.Start, DateTimeKind.Utc));

        var levels = await connection.QueryAsync<(short LevelRank, long Count)>(new CommandDefinition(
            $"""select level_rank, count(*) from event{where} group by 1 order by 1 desc""", parameters, cancellationToken: cancellationToken));

        var eventTypes = await connection.QueryAsync<(long EventType, string? MessageTemplate, short LevelRank, long Count)>(new CommandDefinition(
            $"""
            select event_type, (array_agg(coalesce(message_template, message)))[1], max(level_rank), count(*)
            from event{where}
            group by event_type
            order by 4 desc
            limit 10
            """,
            parameters,
            cancellationToken: cancellationToken));

        var apiKeys = await connection.QueryAsync<(long? ApiKeyId, string? Title, long Count)>(new CommandDefinition(
            $"""
            select s.api_key_id, k.title, s.count
            from (select api_key_id, count(*) as count from event{where} group by 1 order by 2 desc limit 10) s
            left join api_key k on k.id = s.api_key_id
            order by s.count desc
            """,
            parameters,
            cancellationToken: cancellationToken));

        return Results.Ok(new Overview(
            from,
            to,
            bucketSeconds,
            totals.Total,
            totals.Errors,
            totals.Warnings,
            totals.Exceptions,
            totals.DistinctEventTypes,
            FillSeries(buckets, from, to, interval),
            levels.Select(l => new LevelCount(LogLevels.Name(l.LevelRank), l.LevelRank, l.Count)).ToList(),
            eventTypes.Select(e => new EventTypeCount(
                "$" + ((uint)e.EventType).ToString("X8", CultureInfo.InvariantCulture), e.MessageTemplate, e.LevelRank, e.Count)).ToList(),
            apiKeys.Select(k => new ApiKeyCount(k.ApiKeyId, k.Title, k.Count)).ToList()));
    }

    /// <summary>One point per bucket between from and to, zeros where no events.</summary>
    private static List<SeriesPoint> FillSeries(
        Dictionary<DateTime, (DateTime Start, long Total, long Errors, long Warnings)> buckets, DateTimeOffset from, DateTimeOffset to, TimeSpan interval)
    {
        var series = new List<SeriesPoint>();
        var start = Origin + TimeSpan.FromTicks((from.UtcDateTime - Origin).Ticks / interval.Ticks * interval.Ticks);
        for (var bucketStart = start; bucketStart < to.UtcDateTime; bucketStart += interval)
        {
            series.Add(buckets.TryGetValue(bucketStart, out var b)
                ? new SeriesPoint(new DateTimeOffset(bucketStart), b.Total, b.Errors, b.Warnings)
                : new SeriesPoint(new DateTimeOffset(bucketStart), 0, 0, 0));
        }

        return series;
    }
}
