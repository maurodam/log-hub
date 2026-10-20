using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using Dapper;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Npgsql;

namespace LogHub.Api.Features.Auth;

public sealed record UserRecord
{
    public long Id { get; init; }

    public string Username { get; init; } = string.Empty;

    public string? DisplayName { get; init; }

    public string? Email { get; init; }

    public string? PasswordHash { get; init; }

    public string AuthProvider { get; init; } = "Local";

    public string? ExternalId { get; init; }

    public bool MustChangePassword { get; init; }

    public bool IsDisabled { get; init; }

    public string SecurityStamp { get; init; } = string.Empty;

    public int FailedLoginCount { get; init; }

    public DateTime? LockoutEnd { get; init; }
}

public sealed record CurrentUserDto(
    long Id,
    string Username,
    string? DisplayName,
    string? Email,
    string[] Permissions,
    bool MustChangePassword,
    string AuthProvider);

/// <summary>Account queries shared by login, session validation and user management.</summary>
public sealed class UserStore(NpgsqlDataSource dataSource)
{
    public static readonly PasswordHasher<UserRecord> Hasher = new();

    private const string SelectUser = """
        select id, username, display_name, email, password_hash, auth_provider, external_id,
               must_change_password, is_disabled, security_stamp, failed_login_count, lockout_end
        from users
        """;

    public async Task<UserRecord?> FindByUsernameAsync(string username, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRecord>(new CommandDefinition(
            $"""{SelectUser} where lower(username) = lower(@username)""", new { username }, cancellationToken: cancellationToken));
    }

    public async Task<UserRecord?> FindByIdAsync(long id, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRecord>(new CommandDefinition(
            $"""{SelectUser} where id = @id""", new { id }, cancellationToken: cancellationToken));
    }

    public async Task<UserRecord?> FindExternalAsync(string externalId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRecord>(new CommandDefinition(
            $"""{SelectUser} where auth_provider = 'Oidc' and external_id = @externalId""", new { externalId }, cancellationToken: cancellationToken));
    }

    public async Task<string[]> GetPermissionsAsync(long userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return (await connection.QueryAsync<string>(new CommandDefinition(
            """
            select distinct unnest(r.permissions)
            from user_role ur join role r on r.id = ur.role_id
            where ur.user_id = @userId
            """,
            new { userId },
            cancellationToken: cancellationToken))).ToArray();
    }

    public async Task<ClaimsPrincipal> CreatePrincipalAsync(UserRecord userRecord, CancellationToken cancellationToken)
    {
        var id = userRecord.Id.ToString(CultureInfo.InvariantCulture);
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, id),
            new(ClaimTypes.Name, userRecord.Username),
            new(LogHubClaims.UserId, id),
            new(LogHubClaims.SecurityStamp, userRecord.SecurityStamp),
            new(ClaimTypes.AuthenticationMethod, userRecord.AuthProvider),
            new(LogHubClaims.AuthTime, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)),
        };

        if (userRecord.MustChangePassword)
        {
            claims.Add(new Claim(LogHubClaims.MustChangePassword, "true"));
        }

        claims.AddRange((await GetPermissionsAsync(userRecord.Id, cancellationToken)).Select(p => new Claim(LogHubClaims.Permission, p)));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }

    public async Task RecordLoginAsync(long userId, string? rehashedPassword, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            update users
            set failed_login_count = 0, lockout_end = null, last_login_date = now(),
                password_hash = coalesce(@rehashedPassword, password_hash)
            where id = @userId
            """,
            new { userId, rehashedPassword },
            cancellationToken: cancellationToken));
    }

    /// <summary>Counts a failed login; locks the account when the limit is reached.</summary>
    public async Task RecordFailedLoginAsync(long userId, int maxFailures, TimeSpan lockout, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            update users
            set failed_login_count = case when failed_login_count + 1 >= @maxFailures then 0 else failed_login_count + 1 end,
                lockout_end = case when failed_login_count + 1 >= @maxFailures then now() + @lockout else lockout_end end
            where id = @userId
            """,
            new { userId, maxFailures, lockout },
            cancellationToken: cancellationToken));
    }

    public async Task SetPasswordAsync(long userId, string password, bool mustChangePassword, long? changedBy, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            update users
            set password_hash = @passwordHash, must_change_password = @mustChangePassword, security_stamp = @securityStamp,
                failed_login_count = 0, lockout_end = null, user_updated_id = @changedBy, user_updated_date = now()
            where id = @userId
            """,
            new
            {
                userId,
                passwordHash = Hasher.HashPassword(new UserRecord(), password),
                mustChangePassword,
                securityStamp = NewSecurityStamp(),
                changedBy,
            },
            cancellationToken: cancellationToken));
    }

    public static string NewSecurityStamp() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));

    public static string? ValidatePassword(string? password, int minLength) =>
        string.IsNullOrEmpty(password) || password.Length < minLength
            ? $"The password must be at least {minLength} characters long."
            : password.Length > 256 ? "The password is too long." : null;

    public static CurrentUserDto ToCurrentUser(ClaimsPrincipal user, UserRecord? userRecord)
    {
        if (userRecord is null)
        {
            return new CurrentUserDto(user.GetApiKeyId() ?? 0, "api-key", null, null, user.GetPermissions(), false, "ApiKey");
        }

        return new CurrentUserDto(userRecord.Id, userRecord.Username, userRecord.DisplayName, userRecord.Email,
            user.GetPermissions(), userRecord.MustChangePassword, userRecord.AuthProvider);
    }
}
