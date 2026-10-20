using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Events;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Retention;

/// <summary>Body of POST and PUT /api/v1/retention. SignalId null = all events.</summary>
public sealed record RetentionPolicyInput(long? SignalId, int RetentionDays, bool IsEnabled = true);

public sealed record RetentionPolicyDto(
    long Id,
    long? SignalId,
    string? SignalTitle,
    int RetentionDays,
    bool IsEnabled,
    DateTime? LastRunDate,
    long? LastDeletedCount,
    bool IsManagedByEnvironment);

/// <summary>CRUD for /api/v1/retention. At most one all-events policy and one policy per signal (unique index).</summary>
public static class RetentionPolicies
{
    public const int MaxRetentionDays = 3650;

    private const string SelectColumns = """
        select r.id, r.signal_id, s.title as signal_title, r.retention_days, r.is_enabled, r.last_run_date, r.last_deleted_count,
               false as is_managed_by_environment
        """;

    private const string ManagedMessage = "The all-events policy is set by Retention__DefaultDays: change the environment variable instead.";

    public static async Task<IResult> List(NpgsqlDataSource dataSource, IOptions<RetentionOptions> options, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var policies = await connection.QueryAsync<RetentionPolicyDto>(new CommandDefinition(
            $"""
            {SelectColumns}
            from retention r
            left join signal s on s.id = r.signal_id
            order by r.signal_id nulls first, r.id
            """,
            cancellationToken: cancellationToken));

        return Results.Ok(policies.Select(policy => Mark(policy, options.Value)));
    }

    private static RetentionPolicyDto Mark(RetentionPolicyDto policy, RetentionOptions options) =>
        policy with { IsManagedByEnvironment = policy.SignalId is null && options.ManagesAllEventsPolicy };

    /// <summary>409 when the policy (or the requested target) is the all-events policy owned by Retention__DefaultDays.</summary>
    private static async Task<IResult?> CheckNotManagedAsync(
        NpgsqlDataSource dataSource, long? id, long? targetSignalId, RetentionOptions options, CancellationToken cancellationToken)
    {
        if (!options.ManagesAllEventsPolicy)
        {
            return null;
        }

        var isAllEvents = id is null
            ? targetSignalId is null
            : await IsAllEventsPolicyAsync(dataSource, id.Value, cancellationToken) || targetSignalId is null;
        return isAllEvents ? ApiErrors.Result(StatusCodes.Status409Conflict, ManagedMessage) : null;
    }

    private static async Task<bool> IsAllEventsPolicyAsync(NpgsqlDataSource dataSource, long id, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """select exists(select 1 from retention where id = @id and signal_id is null)""", new { id }, cancellationToken: cancellationToken));
    }

    public static async Task<IResult> Create(
        RetentionPolicyInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        IOptions<RetentionOptions> options,
        CancellationToken cancellationToken)
    {
        if (await ValidateAsync(input, user, filters, cancellationToken) is { } error)
        {
            return error;
        }

        if (await CheckNotManagedAsync(dataSource, null, input.SignalId, options.Value, cancellationToken) is { } managed)
        {
            return managed;
        }

        var policy = await SaveAsync(
            """
            insert into retention (signal_id, retention_days, is_enabled, user_created_id)
            values (@signalId, @retentionDays, @isEnabled, @userId)
            returning *
            """,
            input,
            id: null,
            user,
            dataSource,
            cancellationToken);

        return policy.Result ?? Results.Created($"/api/v1/retention/{policy.Value!.Id}", policy.Value);
    }

    public static async Task<IResult> Update(
        long id,
        RetentionPolicyInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        IOptions<RetentionOptions> options,
        CancellationToken cancellationToken)
    {
        if (await ValidateAsync(input, user, filters, cancellationToken) is { } error)
        {
            return error;
        }

        if (await CheckNotManagedAsync(dataSource, id, input.SignalId, options.Value, cancellationToken) is { } managed)
        {
            return managed;
        }

        var policy = await SaveAsync(
            """
            update retention
            set signal_id = @signalId, retention_days = @retentionDays, is_enabled = @isEnabled,
                user_updated_id = @userId, user_updated_date = now()
            where id = @id
            returning *
            """,
            input,
            id,
            user,
            dataSource,
            cancellationToken);

        return policy.Result ?? (policy.Value is null ? Results.NotFound() : Results.Ok(policy.Value));
    }

    public static async Task<IResult> Delete(long id, NpgsqlDataSource dataSource, IOptions<RetentionOptions> options, CancellationToken cancellationToken)
    {
        if (options.Value.ManagesAllEventsPolicy && await IsAllEventsPolicyAsync(dataSource, id, cancellationToken))
        {
            return ApiErrors.Result(StatusCodes.Status409Conflict, ManagedMessage);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var deleted = await connection.ExecuteAsync(new CommandDefinition(
            """delete from retention where id = @id""", new { id }, cancellationToken: cancellationToken));

        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult?> ValidateAsync(
        RetentionPolicyInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        CancellationToken cancellationToken)
    {
        if (input.RetentionDays is < 1 or > MaxRetentionDays)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, $"retentionDays must be between 1 and {MaxRetentionDays}.");
        }

        if (input.SignalId is { } signalId
            && (await filters.GetVisibleSignalsAsync([signalId], user.GetUserId(), cancellationToken)).Count == 0)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "The signal does not exist.");
        }

        return null;
    }

    /// <summary>Runs the insert or update (which must end with "returning *") and reads the saved policy with its signal title.</summary>
    private static async Task<(RetentionPolicyDto? Value, IResult? Result)> SaveAsync(
        string statement,
        RetentionPolicyInput input,
        long? id,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        try
        {
            var policy = await connection.QuerySingleOrDefaultAsync<RetentionPolicyDto>(new CommandDefinition(
                $"""
                with r as ({statement})
                {SelectColumns}
                from r
                left join signal s on s.id = r.signal_id
                """,
                new { id, input.SignalId, input.RetentionDays, input.IsEnabled, userId = user.GetUserId() },
                cancellationToken: cancellationToken));

            return (policy, null);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return (null, ApiErrors.Result(
                StatusCodes.Status409Conflict,
                input.SignalId is null ? "An all-events retention policy already exists." : "A retention policy for this signal already exists."));
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            return (null, ApiErrors.Result(StatusCodes.Status400BadRequest, "The signal does not exist."));
        }
    }
}
