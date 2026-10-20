using System.Globalization;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Auth;

/// <summary>
/// Cookie events: API-style 401/403 instead of redirects, and session revocation.
/// A session ends when its account is deleted or disabled, when the account security stamp changes
/// (password reset, role change), or Auth:MaxSessionHours after sign-in.
/// The account check hits the database at most every 30 seconds per account.
/// </summary>
public sealed class SessionValidator(UserStore userStore, IMemoryCache cache, IOptions<AuthOptions> options) : CookieAuthenticationEvents
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(30);

    public static void Forget(IMemoryCache cache, long userId) => cache.Remove(CacheKey(userId));

    public override async Task ValidatePrincipal(CookieValidatePrincipalContext context)
    {
        var userId = context.Principal?.GetUserId();
        var stamp = context.Principal?.FindFirst(LogHubClaims.SecurityStamp)?.Value;
        var authTime = long.TryParse(context.Principal?.FindFirst(LogHubClaims.AuthTime)?.Value, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : DateTimeOffset.MinValue;
        if (userId is null || stamp is null || DateTimeOffset.UtcNow - authTime > TimeSpan.FromHours(options.Value.MaxSessionHours))
        {
            await RejectAsync(context);
            return;
        }

        var current = await cache.GetOrCreateAsync(CacheKey(userId.Value), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CheckInterval;
            var userRecord = await userStore.FindByIdAsync(userId.Value, context.HttpContext.RequestAborted);
            return userRecord is { IsDisabled: false } ? userRecord.SecurityStamp : null;
        });

        if (current != stamp)
        {
            await RejectAsync(context);
        }
    }

    public override Task RedirectToLogin(RedirectContext<CookieAuthenticationOptions> context) =>
        ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized, "Sign in or use an API key.");

    public override Task RedirectToAccessDenied(RedirectContext<CookieAuthenticationOptions> context) =>
        ApiErrors.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden, "Missing permission for this operation.");

    private static async Task RejectAsync(CookieValidatePrincipalContext context)
    {
        context.RejectPrincipal();
        await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }

    private static string CacheKey(long userId) => $"session:{userId}";
}
