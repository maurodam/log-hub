using System.Globalization;
using System.Security.Claims;

namespace LogHub.Api.Common.Security;

public static class Permissions
{
    public const string Ingest = "Ingest";
    public const string Read = "Read";
    public const string Write = "Write";
    public const string Project = "Project";
    public const string Organization = "Organization";
    public const string System = "System";

    public static readonly string[] All = [Ingest, Read, Write, Project, Organization, System];
}

/// <summary>Claim types issued by LogHub for sessions (users) and API keys.</summary>
public static class LogHubClaims
{
    public const string Permission = "loghub:permission";
    public const string UserId = "loghub:user_id";
    public const string ApiKeyId = "loghub:apikey_id";
    public const string SecurityStamp = "loghub:security_stamp";
    public const string MustChangePassword = "loghub:must_change_password";
    public const string AuthTime = "loghub:auth_time";

    public static long? GetUserId(this ClaimsPrincipal user) => ParseId(user.FindFirstValue(UserId));

    public static long? GetApiKeyId(this ClaimsPrincipal user) => ParseId(user.FindFirstValue(ApiKeyId));

    public static bool HasPermission(this ClaimsPrincipal user, string permission) => user.HasClaim(Permission, permission);

    public static string[] GetPermissions(this ClaimsPrincipal user) =>
        user.FindAll(Permission).Select(claim => claim.Value).Distinct().ToArray();

    private static long? ParseId(string? value) =>
        long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : null;
}

/// <summary>One authorization policy per permission, named like the permission.</summary>
public static class Policies
{
    public const string Read = Permissions.Read;
    public const string Write = Permissions.Write;
    public const string Project = Permissions.Project;
    public const string Organization = Permissions.Organization;
    public const string System = Permissions.System;

    public static IServiceCollection AddLogHubAuthorization(this IServiceCollection services)
    {
        var builder = services.AddAuthorizationBuilder();
        foreach (var permission in Permissions.All)
        {
            builder.AddPolicy(permission, policy => policy.RequireClaim(LogHubClaims.Permission, permission));
        }

        return services;
    }
}
