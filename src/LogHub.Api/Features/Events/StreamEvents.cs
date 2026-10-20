using System.Diagnostics;
using System.Globalization;
using System.Net.ServerSentEvents;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using Npgsql;

namespace LogHub.Api.Features.Events;

/// <summary>
/// GET /api/v1/events/stream: live tail over Server-Sent Events.
/// Sends events written after the connection opened ("log" messages, id = event id), oldest first.
/// The browser reconnects with Last-Event-ID and the stream resumes after that event.
/// A "ping" message at connect time and every 30 s opens the stream immediately and keeps proxies from closing it.
/// New events are found by polling on the id sequence (single writer, so ids grow in commit order).
/// </summary>
public static class StreamEvents
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(30);
    private const int MaxEventsPerPoll = 500;

    public static async Task<IResult> Handle(
        [AsParameters] EventQuery query,
        HttpRequest request,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        StreamLimiter streams,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        EventFilter filter;
        try
        {
            filter = await filters.BuildAsync(query, includeTimeRange: false, user, cancellationToken);
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }

        long? lastEventId = long.TryParse(request.Headers["Last-Event-ID"], NumberStyles.None, CultureInfo.InvariantCulture, out var id)
            ? id
            : null;

        var lastIdParameter = filter.Parameter(0L);
        filter.Where($"id > {lastIdParameter}");
        var sql = $"""{EventRow.SelectColumns}{filter.WhereClause()} order by id limit {MaxEventsPerPoll}""";

        var owner = StreamLimiter.Owner(user);
        if (!streams.TryAcquire(owner))
        {
            return ApiErrors.Result(StatusCodes.Status429TooManyRequests, "Too many live streams open. Close another tab and retry.");
        }

        return TypedResults.ServerSentEvents(ReleaseWhenDone(
            ReadAsync(sql, filter.Parameters, lastIdParameter[1..], lastEventId, dataSource, cancellationToken), () => streams.Release(owner)));
    }

    private static async IAsyncEnumerable<T> ReleaseWhenDone<T>(IAsyncEnumerable<T> items, Action release)
    {
        try
        {
            await foreach (var item in items)
            {
                yield return item;
            }
        }
        finally
        {
            release();
        }
    }

    private static async IAsyncEnumerable<SseItem<LogEventDto?>> ReadAsync(
        string sql,
        DynamicParameters filterParameters,
        string lastIdName,
        long? lastEventId,
        NpgsqlDataSource dataSource,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var lastId = lastEventId ?? await QueryOrDefaultAsync(() => MaxIdAsync(dataSource, cancellationToken));
        var sincePing = Stopwatch.StartNew();

        // First message right away: headers reach the client now, so EventSource reports "open" without waiting for an event.
        yield return new SseItem<LogEventDto?>(null, "ping");

        while (lastId is not null && !cancellationToken.IsCancellationRequested)
        {
            var parameters = new DynamicParameters(filterParameters);
            parameters.Add(lastIdName, lastId.Value);

            var rows = await QueryOrDefaultAsync(() => ReadAsync(sql, parameters, dataSource, cancellationToken));
            if (rows is null)
            {
                yield break;
            }

            foreach (var row in rows)
            {
                lastId = row.Id;
                yield return new SseItem<LogEventDto?>(row.ToDto(), "log") { EventId = row.Id.ToString(CultureInfo.InvariantCulture) };
            }

            if (rows.Count == MaxEventsPerPoll)
            {
                continue;
            }

            if (sincePing.Elapsed >= PingInterval)
            {
                sincePing.Restart();
                yield return new SseItem<LogEventDto?>(null, "ping");
            }

            if (!await DelayAsync(PollInterval, cancellationToken))
            {
                yield break;
            }
        }
    }

    private static async Task<long?> MaxIdAsync(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            """select coalesce(max(id), 0) from event """, cancellationToken: cancellationToken));
    }

    private static async Task<List<EventRow>> ReadAsync(string sql, DynamicParameters parameters, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return (await connection.QueryAsync<EventRow>(new CommandDefinition(sql, parameters, cancellationToken: cancellationToken))).AsList();
    }

    /// <summary>Runs a query; returns null when the client disconnected meanwhile.</summary>
    private static async Task<T?> QueryOrDefaultAsync<T>(Func<Task<T>> query)
    {
        try
        {
            return await query();
        }
        catch (OperationCanceledException)
        {
            return default;
        }
    }

    private static async Task<bool> DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(delay, cancellationToken);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
