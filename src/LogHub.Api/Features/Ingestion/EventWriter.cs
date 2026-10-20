using Microsoft.Extensions.Options;
using Npgsql;
using NpgsqlTypes;

namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// Drains <see cref="EventQueue"/> and writes events to PostgreSQL with binary COPY.
/// Connection errors are retried with backoff (the queue fills up and clients get 503 meanwhile).
/// Data errors fall back to one COPY per event, so one bad event cannot block the others.
/// On shutdown the queue is closed and the remaining events are written.
/// </summary>
public sealed class EventWriter(
    EventQueue queue,
    NpgsqlDataSource dataSource,
    IOptions<IngestionOptions> options,
    ILogger<EventWriter> logger) : BackgroundService
{
    private const string CopyCommand = """
        copy event (timestamp, arrived, level, level_rank, message_template, message, exception, event_type,
                    trace_id, span_id, parent_span_id, span_kind, span_start, properties, renderings, resource, scope, api_key_id)
        from stdin (format binary)
        """;

    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await using var registration = stoppingToken.Register(queue.Complete);
        var pending = new List<IngestionBatch>();

        while (await queue.Reader.WaitToReadAsync(CancellationToken.None))
        {
            pending.Clear();
            var count = 0;
            while (count < options.Value.WriteBatchSize && queue.Reader.TryRead(out var batch))
            {
                pending.Add(batch);
                count += batch.Events.Count;
            }

            await WriteWithRetryAsync(pending, count, stoppingToken);
            queue.Release(count);
        }
    }

    private async Task WriteWithRetryAsync(List<IngestionBatch> batches, int count, CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(1);
        while (true)
        {
            try
            {
                await CopyAsync(batches.SelectMany(b => b.Events.Select(e => (b, e))));
                logger.LogDebug("Wrote {EventCount} events", count);
                return;
            }
            catch (PostgresException ex) when (ex.SqlState.StartsWith("22", StringComparison.Ordinal))
            {
                logger.LogWarning(ex, "Batch of {EventCount} events has invalid data; writing events one by one", count);
                await WriteOneByOneAsync(batches);
                return;
            }
            catch (Exception ex) when (ex is NpgsqlException or TimeoutException)
            {
                if (stoppingToken.IsCancellationRequested)
                {
                    logger.LogError(ex, "Dropped {EventCount} events: database unavailable during shutdown", count);
                    return;
                }

                logger.LogError(ex, "Writing {EventCount} events failed; retrying in {Delay}", count, delay);
                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Shutdown: try once more without waiting.
                }

                delay = TimeSpan.FromTicks(Math.Min(delay.Ticks * 2, MaxRetryDelay.Ticks));
            }
        }
    }

    private async Task WriteOneByOneAsync(List<IngestionBatch> batches)
    {
        foreach (var batch in batches)
        {
            foreach (var e in batch.Events)
            {
                try
                {
                    await CopyAsync([(batch, e)]);
                }
                catch (PostgresException ex) when (ex.SqlState.StartsWith("22", StringComparison.Ordinal))
                {
                    logger.LogWarning(ex, "Dropped event with invalid data from API key {ApiKeyId}", batch.ApiKeyId);
                }
            }
        }
    }

    private async Task CopyAsync(IEnumerable<(IngestionBatch Batch, IngestedEvent Event)> rows)
    {
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var importer = await connection.BeginBinaryImportAsync(CopyCommand);

        foreach (var (batch, e) in rows)
        {
            await importer.StartRowAsync();
            await importer.WriteAsync(e.Timestamp.UtcDateTime, NpgsqlDbType.TimestampTz);
            await importer.WriteAsync(batch.Arrived.UtcDateTime, NpgsqlDbType.TimestampTz);
            await WriteAsync(importer, e.Level, NpgsqlDbType.Varchar);
            await importer.WriteAsync(e.LevelRank, NpgsqlDbType.Smallint);
            await WriteAsync(importer, e.MessageTemplate, NpgsqlDbType.Text);
            await WriteAsync(importer, e.Message, NpgsqlDbType.Text);
            await WriteAsync(importer, e.Exception, NpgsqlDbType.Text);
            await importer.WriteAsync(e.EventType, NpgsqlDbType.Bigint);
            await WriteAsync(importer, e.TraceId, NpgsqlDbType.Varchar);
            await WriteAsync(importer, e.SpanId, NpgsqlDbType.Varchar);
            await WriteAsync(importer, e.ParentSpanId, NpgsqlDbType.Varchar);
            await WriteAsync(importer, e.SpanKind, NpgsqlDbType.Varchar);
            await WriteAsync(importer, e.SpanStart?.UtcDateTime, NpgsqlDbType.TimestampTz);
            await importer.WriteAsync(e.Properties, NpgsqlDbType.Jsonb);
            await WriteAsync(importer, e.Renderings, NpgsqlDbType.Jsonb);
            await WriteAsync(importer, e.Resource, NpgsqlDbType.Jsonb);
            await WriteAsync(importer, e.Scope, NpgsqlDbType.Jsonb);
            await WriteAsync(importer, batch.ApiKeyId, NpgsqlDbType.Bigint);
        }

        await importer.CompleteAsync();
    }

    private static Task WriteAsync<T>(NpgsqlBinaryImporter importer, T? value, NpgsqlDbType type) =>
        value is null ? importer.WriteNullAsync() : importer.WriteAsync(value, type);
}
