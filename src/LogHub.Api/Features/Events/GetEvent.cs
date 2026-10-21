using Dapper;
using Npgsql;

namespace LogHub.Api.Features.Events;

/// <summary>GET /api/v1/events/{id}.</summary>
public static class GetEvent
{
    public static async Task<IResult> Handle(long id, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        var result = await FindAsync(id, dataSource, cancellationToken);
        return result is null ? Results.NotFound() : Results.Ok(result);
    }

    public static async Task<LogEventDto?> FindAsync(long id, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<EventRow>(new CommandDefinition(
            $"""{EventRow.SelectColumns} where id = @id""", new { id }, cancellationToken: cancellationToken));

        return row?.ToDto();
    }
}
