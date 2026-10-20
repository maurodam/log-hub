using System.Security.Cryptography;
using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Auth;

/// <summary>
/// Creates the first administrator when the database has no accounts.
/// Password: Auth:AdminPassword (required outside Development, so no secret ends up in the logs).
/// In Development only, a random one-time password is written to the log when it is missing.
/// </summary>
public static class UserBootstrapper
{
    /// <summary>Example value from .env.example: refused, it is public.</summary>
    private const string ExamplePassword = "change-me-at-least-12-chars";

    public static async Task EnsureAdminAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var dataSource = services.GetRequiredService<NpgsqlDataSource>();
        var options = services.GetRequiredService<IOptions<AuthOptions>>().Value;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(UserBootstrapper));

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition("""lock table users in exclusive mode""", transaction: transaction, cancellationToken: cancellationToken));

        if (await connection.ExecuteScalarAsync<bool>(new CommandDefinition("""select exists(select 1 from users)""", transaction: transaction, cancellationToken: cancellationToken)))
        {
            return;
        }

        var generated = string.IsNullOrEmpty(options.AdminPassword);
        if (generated && !services.GetRequiredService<IHostEnvironment>().IsDevelopment())
        {
            throw new InvalidOperationException("No account exists yet: set Auth__AdminPassword (at least 12 characters) to create the first administrator.");
        }

        if (options.AdminPassword == ExamplePassword)
        {
            throw new InvalidOperationException("Auth__AdminPassword still has the example value from .env.example: choose your own password.");
        }

        var password = generated ? GeneratePassword() : options.AdminPassword!;
        if (UserStore.ValidatePassword(password, options.MinPasswordLength) is { } error)
        {
            throw new InvalidOperationException($"Auth:AdminPassword is not valid. {error}");
        }

        var userId = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            """
            insert into users (username, display_name, password_hash, must_change_password, security_stamp)
            values (@username, 'Administrator', @passwordHash, @mustChangePassword, @securityStamp)
            returning id
            """,
            new
            {
                username = options.AdminUsername,
                passwordHash = UserStore.Hasher.HashPassword(new UserRecord(), password),
                mustChangePassword = generated,
                securityStamp = UserStore.NewSecurityStamp(),
            },
            transaction,
            cancellationToken: cancellationToken));

        await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into user_role (user_id, role_id)
            select @userId, id from role where title = 'Administrator'
            """,
            new { userId },
            transaction,
            cancellationToken: cancellationToken));

        await transaction.CommitAsync(cancellationToken);

        if (generated)
        {
            logger.LogWarning(
                "Created administrator account {Username} with the one-time password {Password}. Sign in and change it now, or set Auth__AdminPassword before the first start",
                options.AdminUsername, password);
        }
        else
        {
            logger.LogInformation("Created administrator account {Username}", options.AdminUsername);
        }
    }

    private static string GeneratePassword() =>
        RandomNumberGenerator.GetString("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 20);
}
