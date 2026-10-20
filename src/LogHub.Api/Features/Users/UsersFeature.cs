using System.Net.Mail;
using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Auth;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Users;

// Classes with setters: Dapper cannot bind PostgreSQL arrays to record constructors.
public sealed record UserDto
{
    public long Id { get; init; }

    public string Username { get; init; } = string.Empty;

    public string? DisplayName { get; init; }

    public string? Email { get; init; }

    public string AuthProvider { get; init; } = "Local";

    public bool IsDisabled { get; init; }

    public bool MustChangePassword { get; init; }

    public long[] RoleIds { get; init; } = [];

    public DateTime? LastLoginDate { get; init; }

    public DateTime? LockoutEnd { get; init; }
}

public sealed record RoleDto
{
    public long Id { get; init; }

    public string Title { get; init; } = string.Empty;

    public string? Description { get; init; }

    public string[] Permissions { get; init; } = [];
}

public sealed record CreateUserRequest(string? Username, string? DisplayName, string? Email, string? Password, long[]? RoleIds, bool MustChangePassword, string? AuthProvider);

public sealed record UpdateUserRequest(string? DisplayName, string? Email, long[]? RoleIds, bool IsDisabled);

public sealed record ResetPasswordRequest(string? NewPassword, bool MustChangePassword);

/// <summary>
/// /api/v1/users and /api/v1/roles (Organization permission).
/// Role changes, password resets and disabling change the security stamp, which ends the user's sessions.
/// At least one enabled account with the System permission must remain.
/// </summary>
public static class UsersFeature
{
    private const string SelectUsers = """
        select a.id, a.username, a.display_name, a.email, a.auth_provider, a.is_disabled, a.must_change_password,
               coalesce(array_agg(ur.role_id) filter (where ur.role_id is not null), '{}') as role_ids,
               a.last_login_date, a.lockout_end
        from users a left join user_role ur on ur.user_id = a.id
        """;

    public static RouteGroupBuilder MapUsers(this RouteGroupBuilder api)
    {
        var users = api.MapGroup("/users").RequireAuthorization(Policies.Organization);
        users.MapGet("/", List);
        users.MapPost("/", Create);
        users.MapPut("/{id:long}", Update);
        users.MapPost("/{id:long}/password", ResetPassword);
        users.MapDelete("/{id:long}", Delete);
        api.MapGet("/roles", ListRoles).RequireAuthorization(Policies.Organization);
        return api;
    }

    private static async Task<IResult> List(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var users = await connection.QueryAsync<UserDto>(new CommandDefinition(
            $"""{SelectUsers} group by a.id order by lower(a.username)""", cancellationToken: cancellationToken));
        return Results.Ok(users);
    }

    private static async Task<IResult> ListRoles(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var roles = await connection.QueryAsync<RoleDto>(new CommandDefinition(
            """select id, title, description, permissions from role order by cardinality(permissions) desc, title """,
            cancellationToken: cancellationToken));
        return Results.Ok(roles);
    }

    private static async Task<IResult> Create(
        CreateUserRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource, IOptions<AuthOptions> options, CancellationToken cancellationToken)
    {
        var provider = request.AuthProvider is null or "Local" ? "Local" : request.AuthProvider == "Oidc" ? "Oidc" : null;
        if (provider is null)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "AuthProvider must be Local or Oidc.");
        }

        var username = request.Username?.Trim();
        if (string.IsNullOrEmpty(username) || username.Length > 100)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Username is required (max 100 characters).");
        }

        if (ValidateEmail(request.Email) is { } emailError)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, emailError);
        }

        if (provider == "Local" && UserStore.ValidatePassword(request.Password, options.Value.MinPasswordLength) is { } passwordError)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, passwordError);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        long id;
        try
        {
            id = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
                """
                insert into users (username, display_name, email, password_hash, auth_provider, must_change_password, security_stamp, user_created_id)
                values (@username, @displayName, @email, @passwordHash, @provider, @mustChangePassword, @securityStamp, @createdBy)
                returning id
                """,
                new
                {
                    username,
                    displayName = Clean(request.DisplayName),
                    email = Clean(request.Email),
                    passwordHash = provider == "Local" ? UserStore.Hasher.HashPassword(new UserRecord(), request.Password!) : null,
                    provider,
                    mustChangePassword = provider == "Local" && request.MustChangePassword,
                    securityStamp = UserStore.NewSecurityStamp(),
                    createdBy = user.GetUserId(),
                },
                transaction,
                cancellationToken: cancellationToken));
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return ApiErrors.Result(StatusCodes.Status409Conflict, "A user with this username already exists.");
        }

        if (await SetRolesAsync(connection, transaction, id, request.RoleIds, user, cancellationToken) is { } roleError)
        {
            return roleError;
        }

        await transaction.CommitAsync(cancellationToken);
        return Results.Created($"/api/v1/users/{id}", await GetAsync(connection, id, cancellationToken));
    }

    private static async Task<IResult> Update(
        long id, UpdateUserRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource, UserStore userStore, IMemoryCache cache,
        CancellationToken cancellationToken)
    {
        if (await CheckCanManageAsync(userStore, id, user, cancellationToken) is { } denied)
        {
            return denied;
        }

        if (ValidateEmail(request.Email) is { } emailError)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, emailError);
        }

        if (request.IsDisabled && id == user.GetUserId())
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "You cannot disable your own account.");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var updated = await connection.ExecuteAsync(new CommandDefinition(
            """
            update users
            set display_name = @displayName, email = @email, is_disabled = @isDisabled, security_stamp = @securityStamp,
                user_updated_id = @updatedBy, user_updated_date = now()
            where id = @id
            """,
            new
            {
                id,
                displayName = Clean(request.DisplayName),
                email = Clean(request.Email),
                request.IsDisabled,
                securityStamp = UserStore.NewSecurityStamp(),
                updatedBy = user.GetUserId(),
            },
            transaction,
            cancellationToken: cancellationToken));

        if (updated == 0)
        {
            return Results.NotFound();
        }

        if (await SetRolesAsync(connection, transaction, id, request.RoleIds, user, cancellationToken) is { } roleError)
        {
            return roleError;
        }

        if (!await HasAdministratorAsync(connection, transaction, cancellationToken))
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "At least one enabled user with the System permission is required.");
        }

        await transaction.CommitAsync(cancellationToken);
        SessionValidator.Forget(cache, id);
        return Results.Ok(await GetAsync(connection, id, cancellationToken));
    }

    private static async Task<IResult> ResetPassword(
        long id, ResetPasswordRequest request, ClaimsPrincipal user, UserStore userStore, IMemoryCache cache,
        IOptions<AuthOptions> options, CancellationToken cancellationToken)
    {
        var userRecord = await userStore.FindByIdAsync(id, cancellationToken);
        if (userRecord is null)
        {
            return Results.NotFound();
        }

        if (await CheckCanManageAsync(userStore, id, user, cancellationToken) is { } denied)
        {
            return denied;
        }

        if (userRecord.AuthProvider != "Local")
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "This user signs in with an external identity provider.");
        }

        if (UserStore.ValidatePassword(request.NewPassword, options.Value.MinPasswordLength) is { } error)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, error);
        }

        await userStore.SetPasswordAsync(id, request.NewPassword!, request.MustChangePassword, user.GetUserId(), cancellationToken);
        SessionValidator.Forget(cache, id);
        return Results.NoContent();
    }

    private static async Task<IResult> Delete(
        long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, UserStore userStore, IMemoryCache cache, CancellationToken cancellationToken)
    {
        if (id == user.GetUserId())
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "You cannot delete your own account.");
        }

        if (await CheckCanManageAsync(userStore, id, user, cancellationToken) is { } denied)
        {
            return denied;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        // Audit columns reference the user: keep the history, drop the reference.
        foreach (var table in new[] { "users", "role", "user_role", "api_key", "signal", "retention", "setting", "alert", "notification", "data_protection_key" })
        {
            await connection.ExecuteAsync(new CommandDefinition(
                $"""
                update {table} set user_created_id = case when user_created_id = @id then null else user_created_id end,
                                   user_updated_id = case when user_updated_id = @id then null else user_updated_id end
                where user_created_id = @id or user_updated_id = @id
                """,
                new { id },
                transaction,
                cancellationToken: cancellationToken));
        }

        var deleted = await connection.ExecuteAsync(new CommandDefinition(
            """delete from users where id = @id""", new { id }, transaction, cancellationToken: cancellationToken));
        if (deleted == 0)
        {
            return Results.NotFound();
        }

        if (!await HasAdministratorAsync(connection, transaction, cancellationToken))
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "At least one enabled user with the System permission is required.");
        }

        await transaction.CommitAsync(cancellationToken);
        SessionValidator.Forget(cache, id);
        return Results.NoContent();
    }

    /// <summary>Replaces the account roles. The caller can only grant roles whose permissions they have themselves.</summary>
    private static async Task<IResult?> SetRolesAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, long userId, long[]? roleIds, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var ids = (roleIds ?? []).Distinct().ToArray();
        var changedBy = user.GetUserId();
        var known = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """select count(*) from role where id = any(@ids)""", new { ids }, transaction, cancellationToken: cancellationToken));
        if (known != ids.Length)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "One or more roles do not exist.");
        }

        var granted = await connection.QueryAsync<string>(new CommandDefinition(
            """select distinct unnest(permissions) from role where id = any(@ids)""", new { ids }, transaction, cancellationToken: cancellationToken));
        if (granted.FirstOrDefault(permission => !user.HasPermission(permission)) is { } missing)
        {
            return ApiErrors.Result(StatusCodes.Status403Forbidden, $"You cannot grant a role with the '{missing}' permission because you do not have it.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            delete from user_role where user_id = @userId and not (role_id = any(@ids));
            insert into user_role (user_id, role_id, user_created_id)
            select @userId, unnest(@ids), @changedBy
            on conflict (user_id, role_id) do nothing;
            """,
            new { userId, ids, changedBy },
            transaction,
            cancellationToken: cancellationToken));
        return null;
    }

    /// <summary>Users with permissions the caller does not have (for example administrators) are off limits.</summary>
    private static async Task<IResult?> CheckCanManageAsync(UserStore userStore, long targetId, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var targetPermissions = await userStore.GetPermissionsAsync(targetId, cancellationToken);
        return targetPermissions.Any(permission => !user.HasPermission(permission))
            ? ApiErrors.Result(StatusCodes.Status403Forbidden, "You cannot manage a user who has permissions you do not have.")
            : null;
    }

    private static Task<bool> HasAdministratorAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken) =>
        connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """
            select exists(
                select 1 from users a
                join user_role ur on ur.user_id = a.id
                join role r on r.id = ur.role_id
                where not a.is_disabled and 'System' = any(r.permissions))
            """,
            transaction: transaction,
            cancellationToken: cancellationToken));

    private static async Task<UserDto> GetAsync(NpgsqlConnection connection, long id, CancellationToken cancellationToken) =>
        await connection.QuerySingleAsync<UserDto>(new CommandDefinition(
            $"""{SelectUsers} where a.id = @id group by a.id """, new { id }, cancellationToken: cancellationToken));

    private static string? ValidateEmail(string? email) =>
        string.IsNullOrWhiteSpace(email) || MailAddress.TryCreate(email.Trim(), out _) ? null : "The email address is not valid.";

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
