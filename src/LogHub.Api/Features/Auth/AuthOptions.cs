namespace LogHub.Api.Features.Auth;

/// <summary>Configuration section "Auth".</summary>
public sealed class AuthOptions
{
    /// <summary>Username of the administrator created when the database has no accounts.</summary>
    public string AdminUsername { get; set; } = "admin";

    /// <summary>Password for that first administrator. When empty, a random one is generated and written to the log once.</summary>
    public string? AdminPassword { get; set; }

    /// <summary>Idle timeout: the session is extended while it is used (sliding expiration).</summary>
    public int SessionHours { get; set; } = 8;

    /// <summary>Absolute limit: a session ends this many hours after sign-in even when it is always in use.</summary>
    public int MaxSessionHours { get; set; } = 168;

    /// <summary>Failed logins for one account from one client IP before that IP is blocked for <see cref="LockoutMinutes"/>.</summary>
    public int MaxFailedLogins { get; set; } = 5;

    /// <summary>Failed logins for one account from any IP before the whole account is locked (distributed guessing).</summary>
    public int LockoutThreshold { get; set; } = 25;

    public int LockoutMinutes { get; set; } = 15;

    public int MinPasswordLength { get; set; } = 12;

    /// <summary>Login attempts allowed per client IP per minute.</summary>
    public int LoginAttemptsPerMinute { get; set; } = 10;

    public OidcOptions Oidc { get; set; } = new();
}

/// <summary>
/// Optional OpenID Connect login (Microsoft Entra ID or any OIDC provider).
/// Entra ID: Authority = https://login.microsoftonline.com/{tenant-id}/v2.0 (single tenant).
/// </summary>
public sealed class OidcOptions
{
    public string? Authority { get; set; }

    public string? ClientId { get; set; }

    public string? ClientSecret { get; set; }

    public string DisplayName { get; set; } = "Microsoft";

    public string CallbackPath { get; set; } = "/signin-oidc";

    /// <summary>Create an account on first login. When false, only accounts created by an administrator can sign in.</summary>
    public bool AutoProvision { get; set; }

    /// <summary>Role given to auto-provisioned accounts.</summary>
    public string DefaultRole { get; set; } = "User (read-only)";

    /// <summary>
    /// Microsoft Entra tenant ids allowed to sign in (the token "tid" claim). Required with a multi-tenant authority
    /// (/common, /organizations); recommended with a single-tenant one.
    /// </summary>
    public string[] AllowedTenants { get; set; } = [];

    public bool IsMultiTenantAuthority =>
        Authority is not null && (Authority.Contains("/common", StringComparison.OrdinalIgnoreCase)
            || Authority.Contains("/organizations", StringComparison.OrdinalIgnoreCase)
            || Authority.Contains("/consumers", StringComparison.OrdinalIgnoreCase));

    public bool Enabled => !string.IsNullOrWhiteSpace(Authority) && !string.IsNullOrWhiteSpace(ClientId);
}
