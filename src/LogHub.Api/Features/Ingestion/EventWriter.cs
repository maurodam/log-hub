using Npgsql;
using NpgsqlTypes;

namespace LogHub.Api.Features.Ingestion;

/// <summary>Persists one accepted CLEF batch atomically before it is acknowledged.</summary>
public sealed class EventWriter(NpgsqlDataSource dataSource)
{
    private const string CopyCommand = """
        copy event (timestamp, arrived, level, level_rank, message_template, message, exception, event_type,
                    trace_id, span_id, parent_span_id, span_kind, span_start, properties, renderings, resource, scope, api_key_id)
        from stdin (format binary)
        """;

    public async Task WriteAsync(IngestionBatch batch, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        await using (var importer = await connection.BeginBinaryImportAsync(CopyCommand, ct))
        {
            foreach (var e in batch.Events)
            {
                await importer.StartRowAsync(ct);
                await importer.WriteAsync(e.Timestamp.UtcDateTime, NpgsqlDbType.TimestampTz, ct);
                await importer.WriteAsync(batch.Arrived.UtcDateTime, NpgsqlDbType.TimestampTz, ct);
                await WriteAsync(importer, e.Level, NpgsqlDbType.Varchar, ct);
                await importer.WriteAsync(e.LevelRank, NpgsqlDbType.Smallint, ct);
                await WriteAsync(importer, e.MessageTemplate, NpgsqlDbType.Text, ct);
                await WriteAsync(importer, e.Message, NpgsqlDbType.Text, ct);
                await WriteAsync(importer, e.Exception, NpgsqlDbType.Text, ct);
                await importer.WriteAsync(e.EventType, NpgsqlDbType.Bigint, ct);
                await WriteAsync(importer, e.TraceId, NpgsqlDbType.Varchar, ct);
                await WriteAsync(importer, e.SpanId, NpgsqlDbType.Varchar, ct);
                await WriteAsync(importer, e.ParentSpanId, NpgsqlDbType.Varchar, ct);
                await WriteAsync(importer, e.SpanKind, NpgsqlDbType.Varchar, ct);
                await WriteAsync(importer, e.SpanStart?.UtcDateTime, NpgsqlDbType.TimestampTz, ct);
                await importer.WriteAsync(e.Properties, NpgsqlDbType.Jsonb, ct);
                await WriteAsync(importer, e.Renderings, NpgsqlDbType.Jsonb, ct);
                await WriteAsync(importer, e.Resource, NpgsqlDbType.Jsonb, ct);
                await WriteAsync(importer, e.Scope, NpgsqlDbType.Jsonb, ct);
                await WriteAsync(importer, batch.ApiKeyId, NpgsqlDbType.Bigint, ct);
            }

            await importer.CompleteAsync(ct);
        }

        await transaction.CommitAsync(ct);
    }

    private static Task WriteAsync<T>(NpgsqlBinaryImporter importer, T? value, NpgsqlDbType type, CancellationToken ct) =>
        value is null ? importer.WriteNullAsync(ct) : importer.WriteAsync(value, type, ct);
}
