using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using Npgsql;

namespace LogHub.Api.Features.Events;

public sealed record EventQueryInput(string? Expression, DateTimeOffset From, DateTimeOffset To, string? Cursor = null);

public static class EventQueryEndpoints
{
    public static async Task<IResult> Execute(EventQueryInput input, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            if (input.From == default || input.To <= input.From || input.To - input.From > TimeSpan.FromDays(30))
            {
                throw new FilterException("Provide an increasing time range of at most 30 days.");
            }

            var filter = new EventFilter().AddTimeRange(input.From, input.To);
            var aggregate = EventQueryLanguage.Compile(input.Expression, filter);
            if (aggregate is null)
            {
                return Results.Ok(await ListEvents.QueryAsync(filter, 100, input.Cursor, dataSource, timeout.Token, 5));
            }

            if (input.Cursor is not null)
            {
                throw new FilterException("Aggregate queries do not use a cursor.");
            }

            var group = aggregate.Group ?? "null";
            var grouping = aggregate.Group is null ? "" : " group by 1 order by 1 nulls last limit 100";
            var sql = $"select to_jsonb(result)::text from (select {group} as key, {aggregate.Value} as value from event{filter.WhereClause()}{grouping}) result";
            await using var db = await dataSource.OpenConnectionAsync(timeout.Token);
            var rows = await db.QueryAsync<string>(new CommandDefinition(sql, filter.Parameters, commandTimeout: 5, cancellationToken: timeout.Token));
            return Results.Ok(new { groups = rows.Select(row => JsonSerializer.Deserialize<JsonElement>(row)) });
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested && (
            ex is TimeoutException or OperationCanceledException or PostgresException { SqlState: "57014" }
            || ex is NpgsqlException { InnerException: TimeoutException }))
        {
            return ApiErrors.Result(StatusCodes.Status504GatewayTimeout, "Query timed out. Choose a shorter time range or a more selective filter.");
        }
    }
}
