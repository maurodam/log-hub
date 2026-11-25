using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using Npgsql;

namespace LogHub.Api.Features.Events;

public sealed record DashboardWidget(string? Title, string? Expression, int Hours, string? View);
public sealed record DashboardInput(string? Name, DashboardWidget[]? Widgets, int Revision);

public static class SavedDashboardEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var dashboards = api.MapGroup("/dashboards");
        dashboards.MapGet("/", List).RequireAuthorization(Policies.Read);
        dashboards.MapPost("/", (DashboardInput input, NpgsqlDataSource db, CancellationToken ct) => Save(null, input, db, ct))
            .RequireAuthorization(Policies.Project);
        dashboards.MapPut("/{id:long}", (long id, DashboardInput input, NpgsqlDataSource db, CancellationToken ct) => Save(id, input, db, ct))
            .RequireAuthorization(Policies.Project);
        dashboards.MapDelete("/{id:long}", Delete).RequireAuthorization(Policies.Project);
    }

    private static async Task<IResult> List(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var db = await dataSource.OpenConnectionAsync(ct);
        var rows = await db.QueryAsync<Row>(new CommandDefinition(
            "select id, name, widgets::text, revision from saved_dashboard order by name, id", cancellationToken: ct));
        return Results.Ok(rows.Select(Serialize));
    }

    private static async Task<IResult> Save(long? id, DashboardInput input, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var name = input.Name?.Trim();
        var widgets = input.Widgets ?? [];
        if (name is not { Length: > 0 and <= 100 } || widgets.Length > 12)
        {
            return Bad("Provide a name of 1 to 100 characters and up to 12 widgets.");
        }

        try
        {
            foreach (var widget in widgets)
            {
                ValidateWidget(widget);
            }
        }
        catch (FilterException ex)
        {
            return Bad(ex.Message);
        }

        await using var db = await dataSource.OpenConnectionAsync(ct);
        var sql = id is null
            ? "insert into saved_dashboard (name, widgets) values (@name, @json::jsonb)"
            : "update saved_dashboard set name = @name, widgets = @json::jsonb, revision = revision + 1 where id = @id and revision = @revision";
        var row = await db.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"{sql} returning id, name, widgets::text, revision",
            new { id, name, json = JsonSerializer.Serialize(widgets, JsonSerializerOptions.Web), input.Revision }, cancellationToken: ct));
        if (row is null)
        {
            return ApiErrors.Result(StatusCodes.Status409Conflict, "The dashboard changed. Reload it before saving.");
        }
        return id is null ? Results.Created($"/api/v1/dashboards/{row.Id}", Serialize(row)) : Results.Ok(Serialize(row));
    }

    private static void ValidateWidget(DashboardWidget? widget)
    {
        if (widget is null || widget.Title?.Trim() is not { Length: > 0 and <= 100 }
            || widget.Hours is < 1 or > 720 || widget.View is not ("number" or "table" or "series"))
        {
            throw new FilterException("Each widget needs a title, a period of 1 to 720 hours and a valid visualization.");
        }

        var query = EventQueryLanguage.Compile(widget.Expression, new EventFilter());
        if (widget.View == "number" && (query is null || query.Group is not null))
        {
            throw new FilterException("A number widget needs an aggregate without GROUP BY.");
        }
        if (widget.View == "series" && (query?.Group?.StartsWith("date_bin(", StringComparison.Ordinal) != true))
        {
            throw new FilterException("A time series needs an aggregate grouped by BUCKET.");
        }
    }

    private static async Task<IResult> Delete(long id, int revision, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var db = await dataSource.OpenConnectionAsync(ct);
        var affected = await db.ExecuteAsync(new CommandDefinition(
            "delete from saved_dashboard where id = @id and revision = @revision", new { id, revision }, cancellationToken: ct));
        return affected == 0
            ? ApiErrors.Result(StatusCodes.Status409Conflict, "The dashboard changed. Reload it before deleting.")
            : Results.NoContent();
    }

    private static object Serialize(Row row) =>
        new { row.Id, row.Name, row.Revision, widgets = JsonSerializer.Deserialize<JsonElement>(row.Widgets) };

    private static IResult Bad(string message) => ApiErrors.Result(StatusCodes.Status400BadRequest, message);
    private sealed record Row(long Id, string Name, string Widgets, int Revision);
}
