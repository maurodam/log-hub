using Dapper;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Auth;

/// <summary>
/// Maps an OpenID Connect login to a LogHub account, then replaces the external principal with the LogHub one
/// (the cookie scheme stores it). Lookup order:
/// 1. account already linked to the provider subject (Entra "oid", otherwise "sub");
/// 2. account created by an administrator with provider "Oidc" and the same username (preferred_username/email), not linked yet;
/// 3. new account, only when Auth:Oidc:AutoProvision is true.
/// Local accounts are never linked automatically (prevents takeover through an unverified email claim).
/// </summary>
public static class OidcUserMapper
{
    public static async Task OnTokenValidated(TokenValidatedContext context)
    {
        var services = context.HttpContext.RequestServices;
        var userStore = services.GetRequiredService<UserStore>();
        var options = services.GetRequiredService<IOptions<AuthOptions>>().Value.Oidc;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(OidcUserMapper));
        var cancellationToken = context.HttpContext.RequestAborted;

        var principal = context.Principal!;
        var externalId = principal.FindFirst("oid")?.Value ?? principal.FindFirst("sub")?.Value;
        var username = principal.FindFirst("preferred_username")?.Value ?? principal.FindFirst("email")?.Value;
        var email = principal.FindFirst("email")?.Value ?? (username?.Contains('@') == true ? username : null);
        var name = principal.FindFirst("name")?.Value;

        if (externalId is null)
        {
            context.Fail("The identity provider did not return a subject.");
            return;
        }

        var tenantId = principal.FindFirst("tid")?.Value;
        if (!IsAllowedTenant(options, tenantId))
        {
            logger.LogWarning("OIDC login refused for {Username}: tenant {TenantId} is not allowed", username, tenantId);
            context.Fail("This tenant is not allowed.");
            return;
        }

        var userRecord = await userStore.FindExternalAsync(externalId, cancellationToken)
            ?? (username is null ? null : await LinkPreCreatedAsync(services, username, externalId, cancellationToken))
            ?? (options.AutoProvision && username is not null
                ? await ProvisionAsync(services, username, email, name, externalId, options.DefaultRole, cancellationToken)
                : null);

        if (userRecord is null || userRecord.IsDisabled)
        {
            logger.LogWarning("OIDC login refused for {Username} ({ExternalId}): no enabled LogHub account", username, externalId);
            context.Fail("No enabled LogHub account for this identity.");
            return;
        }

        await userStore.RecordLoginAsync(userRecord.Id, null, cancellationToken);
        context.Principal = await userStore.CreatePrincipalAsync(userRecord, cancellationToken);
        logger.LogInformation("User {Username} signed in with OpenID Connect", userRecord.Username);
    }

    /// <summary>With Auth:Oidc:AllowedTenants set, the token tenant ("tid") must be one of them.</summary>
    public static bool IsAllowedTenant(OidcOptions options, string? tenantId) =>
        options.AllowedTenants.Length == 0
        || (tenantId is not null && options.AllowedTenants.Contains(tenantId, StringComparer.OrdinalIgnoreCase));

    private static async Task<UserRecord?> LinkPreCreatedAsync(IServiceProvider services, string username, string externalId, CancellationToken cancellationToken)
    {
        var dataSource = services.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var id = await connection.ExecuteScalarAsync<long?>(new CommandDefinition(
            """
            update users set external_id = @externalId, user_updated_date = now()
            where auth_provider = 'Oidc' and external_id is null and lower(username) = lower(@username)
            returning id
            """,
            new { username, externalId },
            cancellationToken: cancellationToken));

        return id is null ? null : await services.GetRequiredService<UserStore>().FindByIdAsync(id.Value, cancellationToken);
    }

    private static async Task<UserRecord?> ProvisionAsync(
        IServiceProvider services, string username, string? email, string? name, string externalId, string role, CancellationToken cancellationToken)
    {
        var dataSource = services.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var id = await connection.ExecuteScalarAsync<long?>(new CommandDefinition(
            """
            with created as (
                insert into users (username, display_name, email, auth_provider, external_id, security_stamp)
                select @username, @name, @email, 'Oidc', @externalId, @securityStamp
                where not exists (select 1 from users where lower(username) = lower(@username))
                returning id
            ), roles as (
                insert into user_role (user_id, role_id)
                select created.id, r.id from created, role r where r.title = @role
            )
            select id from created
            """,
            new { username, name, email, externalId, role, securityStamp = UserStore.NewSecurityStamp() },
            cancellationToken: cancellationToken));

        return id is null ? null : await services.GetRequiredService<UserStore>().FindByIdAsync(id.Value, cancellationToken);
    }
}
