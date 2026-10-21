using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Events;
using Npgsql;

namespace LogHub.Api.Features.Signals;

public sealed record SignalInput(string? Title, string? Description, string? GroupName, FilterSpec? Filter, bool IsShared);

public sealed record SignalDto(long Id, string Title, string? Description, string? GroupName, FilterSpec Filter, bool IsShared, bool IsProtected, bool IsOwn);

/// <summary>
/// /api/v1/signals: saved filters. Everyone with Read sees shared signals plus their own.
/// Personal signals need Write and belong to the caller; shared signals need Project. Protected signals cannot change.
/// </summary>
public static class SignalsFeature
{
    private const string Select = """
        select id, title, description, group_name, filter::text as filter, is_protected, owner_id from signal
        """;

    public static RouteGroupBuilder MapSignals(this RouteGroupBuilder api)
    {
        var signals = api.MapGroup("/signals");
        signals.MapGet("/", List).RequireAuthorization(Policies.Read);
        signals.MapPost("/", Create).RequireAuthorization(Policies.Write);
        signals.MapPut("/{id:long}", Update).RequireAuthorization(Policies.Write);
        signals.MapDelete("/{id:long}", Delete).RequireAuthorization(Policies.Write);
        return api;
    }

    private static async Task<IResult> List(ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
        => Results.Ok(await ListAsync(user.GetUserId(), dataSource, cancellationToken));

    public static async Task<List<SignalDto>> ListAsync(long? userId, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<SignalRow>(new CommandDefinition(
            $"""{Select} where owner_id is null or owner_id = @userId order by group_name nulls last, lower(title)""",
            new { userId },
            cancellationToken: cancellationToken));
        return rows.Select(row => row.ToDto(userId)).ToList();
    }

    private static async Task<IResult> Create(SignalInput input, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        var userId = user.GetUserId();
        if (Validate(input) is { } error)
        {
            return error;
        }

        if (input.IsShared && !user.HasPermission(Permissions.Project))
        {
            return ApiErrors.Result(StatusCodes.Status403Forbidden, "Shared signals need the Project permission.");
        }

        if (!input.IsShared && userId is null)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "API keys can only create shared signals.");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var id = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            """
            insert into signal (title, description, group_name, filter, owner_id, user_created_id)
            values (@title, @description, @groupName, @filter::jsonb, @ownerId, @userId)
            returning id
            """,
            new
            {
                title = input.Title!.Trim(),
                description = Clean(input.Description),
                groupName = Clean(input.GroupName),
                filter = (input.Filter ?? new FilterSpec()).ToJson(),
                ownerId = input.IsShared ? null : userId,
                userId,
            },
            cancellationToken: cancellationToken));

        return Results.Created($"/api/v1/signals/{id}", (await GetAsync(connection, id, cancellationToken))!.ToDto(userId));
    }

    private static async Task<IResult> Update(long id, SignalInput input, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        var userId = user.GetUserId();
        if (Validate(input) is { } error)
        {
            return error;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var existing = await GetAsync(connection, id, cancellationToken);
        if (CheckAccess(existing, user) is { } denied)
        {
            return denied;
        }

        if (input.IsShared != (existing!.OwnerId is null) && !user.HasPermission(Permissions.Project))
        {
            return ApiErrors.Result(StatusCodes.Status403Forbidden, "Sharing or unsharing a signal needs the Project permission.");
        }

        if (!input.IsShared && existing.OwnerId is null && userId is null)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "API keys can only manage shared signals.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            update signal
            set title = @title, description = @description, group_name = @groupName, filter = @filter::jsonb,
                owner_id = @ownerId, user_updated_id = @userId, user_updated_date = now()
            where id = @id
            """,
            new
            {
                id,
                title = input.Title!.Trim(),
                description = Clean(input.Description),
                groupName = Clean(input.GroupName),
                filter = (input.Filter ?? new FilterSpec()).ToJson(),
                ownerId = input.IsShared ? null : existing.OwnerId ?? userId,
                userId,
            },
            cancellationToken: cancellationToken));

        return Results.Ok((await GetAsync(connection, id, cancellationToken))!.ToDto(userId));
    }

    private static async Task<IResult> Delete(long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        if (CheckAccess(await GetAsync(connection, id, cancellationToken), user) is { } denied)
        {
            return denied;
        }

        await connection.ExecuteAsync(new CommandDefinition("""delete from signal where id = @id""", new { id }, cancellationToken: cancellationToken));
        return Results.NoContent();
    }

    private static IResult? CheckAccess(SignalRow? signal, ClaimsPrincipal user)
    {
        var userId = user.GetUserId();
        if (signal is null || (signal.OwnerId is not null && signal.OwnerId != userId))
        {
            return Results.NotFound();
        }

        if (signal.IsProtected)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Built-in signals cannot be changed or deleted.");
        }

        return signal.OwnerId is null && !user.HasPermission(Permissions.Project)
            ? ApiErrors.Result(StatusCodes.Status403Forbidden, "Shared signals need the Project permission.")
            : null;
    }

    private static IResult? Validate(SignalInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Trim().Length > 200)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Title is required (max 200 characters).");
        }

        if (input.GroupName?.Trim().Length > 100)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Group name is too long (max 100 characters).");
        }

        try
        {
            new EventFilter().AddSpec(input.Filter ?? new FilterSpec());
            return null;
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }
    }

    private static Task<SignalRow?> GetAsync(NpgsqlConnection connection, long id, CancellationToken cancellationToken) =>
        connection.QuerySingleOrDefaultAsync<SignalRow>(new CommandDefinition(
            $"""{Select} where id = @id""", new { id }, cancellationToken: cancellationToken));

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record SignalRow
    {
        public long Id { get; init; }

        public string Title { get; init; } = string.Empty;

        public string? Description { get; init; }

        public string? GroupName { get; init; }

        public string Filter { get; init; } = "{}";

        public bool IsProtected { get; init; }

        public long? OwnerId { get; init; }

        public SignalDto ToDto(long? userId) => new(Id, Title, Description, GroupName, FilterSpec.FromJson(Filter),
            OwnerId is null, IsProtected, OwnerId is not null && OwnerId == userId);
    }
}
