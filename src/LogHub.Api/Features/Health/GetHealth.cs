using Dapper;
using Npgsql;

namespace LogHub.Api.Features.Health;

/// <summary>GET /health: 200 when the database answers, 503 otherwise.</summary>
public static class GetHealth
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder app)
    {
        app.MapGet("/health", Handle);
        return app;
    }

    private static async Task<IResult> Handle(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await connection.ExecuteScalarAsync<int>(new CommandDefinition("select 1", cancellationToken: cancellationToken));
            return Results.Ok(new { Status = "Healthy" });
        }
        catch (NpgsqlException)
        {
            return Results.Json(new { Status = "Unhealthy" }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
