using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Threading.Channels;
using Dapper;
using LogHub.Api.Features.Events;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Retention;

/// <summary>Outcome of one retention run. DeletedEvents counts dropped partitions by estimate.</summary>
public sealed record RetentionRunResult(int CreatedPartitions, int DroppedPartitions, long DeletedEvents);

/// <summary>
/// Retention job: every Retention:IntervalMinutes (first run Retention:InitialDelaySeconds after startup) and on demand.
/// 1. Creates the daily event partitions for today and the next 3 days (UTC), unless event_default already holds rows of that day.
/// 2. All-events policy: drops daily partitions entirely older than the cutoff, then deletes older rows in batches.
/// 3. Signal policies: delete older events matching the signal in batches.
/// A PostgreSQL advisory lock lets only one replica run the job at a time.
/// </summary>
public sealed class RetentionService(
    NpgsqlDataSource dataSource,
    IOptions<RetentionOptions> options,
    ILogger<RetentionService> logger) : BackgroundService
{
    private const long LockKey = 0x4C6F674875625274; // "LogHubRt"
    private const int BatchSize = 10000;
    private const int FutureDays = 3;
    private const int CommandTimeoutSeconds = 300;

    private readonly Channel<bool> triggers = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    private readonly SemaphoreSlim running = new(1, 1);

    /// <summary>Asks the background loop to run the job now (POST /retention/run).</summary>
    public void Trigger() => triggers.Writer.TryWrite(true);

    /// <summary>Runs the job now and waits for it. Returns null when another replica holds the lock.</summary>
    public async Task<RetentionRunResult?> RunOnceAsync(CancellationToken cancellationToken)
    {
        await running.WaitAsync(cancellationToken);
        try
        {
            await using var lockConnection = await dataSource.OpenConnectionAsync(cancellationToken);
            var acquired = await lockConnection.ExecuteScalarAsync<bool>(new CommandDefinition(
                "select pg_try_advisory_lock(@key)", new { key = LockKey }, cancellationToken: cancellationToken));
            if (!acquired)
            {
                logger.LogInformation("Retention job skipped: another instance is running it");
                return null;
            }

            try
            {
                return await RunAsync(cancellationToken);
            }
            finally
            {
                await lockConnection.ExecuteScalarAsync<bool>(new CommandDefinition(
                    "select pg_advisory_unlock(@key)", new { key = LockKey }, cancellationToken: CancellationToken.None));
            }
        }
        finally
        {
            running.Release();
        }
    }

    public override void Dispose()
    {
        running.Dispose();
        base.Dispose();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(Math.Max(0, options.Value.InitialDelaySeconds));
        while (true)
        {
            await WaitForTriggerAsync(delay, stoppingToken);
            if (stoppingToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Retention job failed");
            }

            delay = TimeSpan.FromMinutes(Math.Max(1, options.Value.IntervalMinutes));
        }
    }

    /// <summary>Waits for the delay, a trigger or shutdown.</summary>
    private async Task WaitForTriggerAsync(TimeSpan delay, CancellationToken stoppingToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        timeout.CancelAfter(delay);
        try
        {
            await triggers.Reader.ReadAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            // Interval elapsed or shutdown; the caller checks the stopping token.
        }
    }

    private async Task<RetentionRunResult> RunAsync(CancellationToken cancellationToken)
    {
        var started = Stopwatch.GetTimestamp();
        var now = DateTime.UtcNow;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var partitions = await EventPartitions.ListAsync(connection, cancellationToken);
        var created = await CreatePartitionsAsync(connection, partitions, now, cancellationToken);

        var policies = (await connection.QueryAsync<(long Id, long? SignalId, int RetentionDays)>(new CommandDefinition(
            """select id, signal_id, retention_days from retention where is_enabled order by signal_id nulls first, id """,
            cancellationToken: cancellationToken))).AsList();

        var dropped = 0;
        long deletedTotal = 0;
        foreach (var policy in policies)
        {
            var cutoff = now.AddDays(-policy.RetentionDays);
            long deleted;
            if (policy.SignalId is null)
            {
                var (droppedPartitions, droppedRows) = await DropPartitionsAsync(connection, partitions, cutoff, cancellationToken);
                dropped += droppedPartitions;
                deleted = droppedRows + await DeleteAsync(connection, new EventFilter().AddTimeRange(null, cutoff), cutoff, cancellationToken);
            }
            else
            {
                EventFilter filter;
                try
                {
                    var signal = await LoadSignalAsync(connection, policy.SignalId.Value, cancellationToken);
                    if (signal is null)
                    {
                        continue;
                    }

                    filter = new EventFilter().AddTimeRange(null, cutoff).AddSignals([signal]);
                }
                catch (FilterException ex)
                {
                    logger.LogWarning("Retention policy {PolicyId} skipped: signal {SignalId} has an invalid filter ({Reason})", policy.Id, policy.SignalId, ex.Message);
                    continue;
                }

                deleted = await DeleteAsync(connection, filter, cutoff, cancellationToken);
            }

            deletedTotal += deleted;
            await connection.ExecuteAsync(new CommandDefinition(
                """update retention set last_run_date = now(), last_deleted_count = @deleted where id = @id""",
                new { id = policy.Id, deleted },
                cancellationToken: cancellationToken));
        }

        logger.LogInformation(
            "Retention job finished in {Elapsed:0} ms: {PolicyCount} policies, {CreatedPartitions} partitions created, {DroppedPartitions} partitions dropped, {DeletedEvents} events deleted (dropped partitions by estimate)",
            Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            policies.Count,
            created,
            dropped,
            deletedTotal);

        return new RetentionRunResult(created, dropped, deletedTotal);
    }

    /// <summary>
    /// Creates event_yyyymmdd for today and the next days. A day whose events already sit in event_default is skipped:
    /// creating the partition would fail, and the job never moves data.
    /// </summary>
    private async Task<int> CreatePartitionsAsync(
        NpgsqlConnection connection,
        List<EventPartition> partitions,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var existing = partitions.Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        var today = DateOnly.FromDateTime(now);
        var created = 0;

        for (var offset = 0; offset <= FutureDays; offset++)
        {
            var day = today.AddDays(offset);
            var name = EventPartitions.Name(day);
            if (existing.Contains(name))
            {
                continue;
            }

            var from = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var to = from.AddDays(1);
            var occupied = await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
                $"""select exists (select 1 from {EventPartitions.DefaultPartition} where timestamp >= @from and timestamp < @to)""",
                new { from, to },
                cancellationToken: cancellationToken));
            if (occupied)
            {
                logger.LogInformation("Partition {Partition} not created: {DefaultPartition} already holds events of that day", name, EventPartitions.DefaultPartition);
                continue;
            }

            var sql = string.Create(
                CultureInfo.InvariantCulture,
                $"""create table if not exists {name} partition of event for values from ('{from:yyyy-MM-dd} 00:00:00+00') to ('{to:yyyy-MM-dd} 00:00:00+00')""");
            if (await TryExecuteDdlAsync(connection, sql, name, cancellationToken))
            {
                created++;
                logger.LogInformation("Created partition {Partition}", name);
            }
        }

        return created;
    }

    /// <summary>Drops the daily partitions whose upper bound is not after the cutoff. Rows are counted by estimate.</summary>
    private async Task<(int Partitions, long Rows)> DropPartitionsAsync(
        NpgsqlConnection connection,
        List<EventPartition> partitions,
        DateTime cutoff,
        CancellationToken cancellationToken)
    {
        var dropped = 0;
        long rows = 0;
        foreach (var partition in partitions.Where(p => EventPartitions.IsDaily(p.Name) && p.To <= cutoff).ToList())
        {
            // reltuples is 0 when the partition was never analyzed: count it (one day of data at most).
            var estimate = partition.Rows > 0
                ? partition.Rows
                : await connection.ExecuteScalarAsync<long>(new CommandDefinition(
                    $"""select count(*) from {partition.Name}""", commandTimeout: CommandTimeoutSeconds, cancellationToken: cancellationToken));

            if (await TryExecuteDdlAsync(connection, $"""drop table {partition.Name}""", partition.Name, cancellationToken))
            {
                partitions.Remove(partition);
                dropped++;
                rows += estimate;
                logger.LogInformation("Dropped partition {Partition} (about {EventCount} events)", partition.Name, estimate);
            }
        }

        return (dropped, rows);
    }

    /// <summary>Deletes the events matched by the filter (which includes timestamp &lt; cutoff), 10000 per statement.</summary>
    private static async Task<long> DeleteAsync(NpgsqlConnection connection, EventFilter filter, DateTime cutoff, CancellationToken cancellationToken)
    {
        // The outer cutoff condition lets PostgreSQL prune the partitions that hold only newer events.
        var sql = $"""
            delete from event
            where timestamp < {filter.Parameter(cutoff)}
              and (id, timestamp) in (select id, timestamp from event{filter.WhereClause()} limit {BatchSize})
            """;

        long total = 0;
        while (true)
        {
            var deleted = await connection.ExecuteAsync(new CommandDefinition(
                sql, filter.Parameters, commandTimeout: CommandTimeoutSeconds, cancellationToken: cancellationToken));
            total += deleted;
            if (deleted < BatchSize)
            {
                return total;
            }
        }
    }

    /// <summary>Partition DDL waits at most 10 s for locks (busy readers); on timeout the next run retries.</summary>
    private async Task<bool> TryExecuteDdlAsync(NpgsqlConnection connection, string sql, string partition, CancellationToken cancellationToken)
    {
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await connection.ExecuteAsync(new CommandDefinition("set local lock_timeout = '10s'", transaction: transaction, cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(sql, transaction: transaction, commandTimeout: CommandTimeoutSeconds, cancellationToken: cancellationToken));
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.LockNotAvailable or PostgresErrorCodes.CheckViolation)
        {
            // CheckViolation: an event of that day reached event_default after the check.
            logger.LogInformation("Partition {Partition} skipped: {Reason}", partition, ex.MessageText);
            return false;
        }
    }

    /// <summary>The job acts for the system: any signal counts, whatever its owner.</summary>
    private static async Task<SignalDefinition?> LoadSignalAsync(DbConnection connection, long id, CancellationToken cancellationToken)
    {
        var rows = await connection.QueryAsync<(long Id, string? GroupName, string Filter)>(new CommandDefinition(
            """select id, group_name, filter::text from signal where id = @id""", new { id }, cancellationToken: cancellationToken));
        if (rows.FirstOrDefault() is not { Id: > 0 } signal)
        {
            return null;
        }

        try
        {
            return new SignalDefinition(signal.Id, signal.GroupName, FilterSpec.FromJson(signal.Filter));
        }
        catch (JsonException)
        {
            throw new FilterException($"Signal {id} has an invalid filter.");
        }
    }
}
