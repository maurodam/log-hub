using System.Security.Claims;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Auth;

public sealed record LoginRequest(string? Username, string? Password);

public sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);

/// <summary>/api/v1/auth: providers, login, logout, current user, password change, OIDC login.</summary>
public static class AuthEndpoints
{
    public const string XsrfCookieName = "XSRF-TOKEN";

    // Verified when the username does not exist, so both cases take the same time.
    private static readonly string DummyHash = UserStore.Hasher.HashPassword(new UserRecord(), "not-a-real-password");

    public static RouteGroupBuilder MapAuthEndpoints(this RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth").WithMetadata(new AllowPendingPasswordChangeAttribute());
        auth.MapGet("/providers", Providers).AllowAnonymous();
        auth.MapPost("/login", Login).AllowAnonymous().RequireRateLimiting(AuthFeature.LoginRateLimit).WithMetadata(new SkipCsrfAttribute());
        auth.MapPost("/logout", (Delegate)Logout);
        auth.MapGet("/me", Me);
        auth.MapPost("/change-password", ChangePassword);
        auth.MapGet("/oidc/login", OidcLogin).AllowAnonymous();
        return api;
    }

    private static IResult Providers(IOptions<AuthOptions> options)
    {
        var oidc = options.Value.Oidc;
        return Results.Ok(new { local = true, oidc = new { enabled = oidc.Enabled, displayName = oidc.Enabled ? oidc.DisplayName : null } });
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        HttpContext http,
        UserStore userStore,
        LoginThrottle throttle,
        IAntiforgery antiforgery,
        IOptions<AuthOptions> options,
        ILogger<LoginRequest> logger,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password) || request.Password.Length > 256)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Username and password are required.");
        }

        var clientIp = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var userRecord = await userStore.FindByUsernameAsync(request.Username.Trim(), cancellationToken);
        if (userRecord is not { AuthProvider: "Local", PasswordHash: not null, IsDisabled: false })
        {
            UserStore.Hasher.VerifyHashedPassword(new UserRecord(), DummyHash, request.Password);
            logger.LogWarning("Failed login for {Username} from {ClientIp}: unknown, disabled or external account", request.Username, clientIp);
            return InvalidCredentials();
        }

        // Blocked and locked attempts get the same answer and timing as a wrong password (no account enumeration).
        if (throttle.IsBlocked(userRecord.Id, clientIp) || userRecord.LockoutEnd > DateTime.UtcNow)
        {
            UserStore.Hasher.VerifyHashedPassword(new UserRecord(), DummyHash, request.Password);
            logger.LogWarning("Login refused for {Username} from {ClientIp}: too many failed attempts", userRecord.Username, clientIp);
            return InvalidCredentials();
        }

        var verification = UserStore.Hasher.VerifyHashedPassword(userRecord, userRecord.PasswordHash, request.Password);
        if (verification == PasswordVerificationResult.Failed)
        {
            throttle.RecordFailure(userRecord.Id, clientIp);
            await userStore.RecordFailedLoginAsync(userRecord.Id, settings.LockoutThreshold, TimeSpan.FromMinutes(settings.LockoutMinutes), cancellationToken);
            logger.LogWarning("Failed login for {Username} from {ClientIp}: wrong password", userRecord.Username, clientIp);
            return InvalidCredentials();
        }

        throttle.Reset(userRecord.Id, clientIp);
        var rehashed = verification == PasswordVerificationResult.SuccessRehashNeeded
            ? UserStore.Hasher.HashPassword(userRecord, request.Password)
            : null;
        await userStore.RecordLoginAsync(userRecord.Id, rehashed, cancellationToken);
        await SignInAsync(http, antiforgery, await userStore.CreatePrincipalAsync(userRecord, cancellationToken));

        logger.LogInformation("User {Username} signed in", userRecord.Username);
        return Results.Ok(UserStore.ToCurrentUser(http.User, userRecord));
    }

    private static async Task<IResult> Logout(HttpContext http)
    {
        await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        http.Response.Cookies.Delete(XsrfCookieName);
        return Results.NoContent();
    }

    private static async Task<IResult> Me(ClaimsPrincipal user, HttpContext http, UserStore userStore, IAntiforgery antiforgery, CancellationToken cancellationToken)
    {
        var userId = user.GetUserId();
        if (userId is null)
        {
            return Results.Ok(UserStore.ToCurrentUser(user, null));
        }

        var userRecord = await userStore.FindByIdAsync(userId.Value, cancellationToken);
        if (userRecord is null)
        {
            return ApiErrors.Result(StatusCodes.Status401Unauthorized, "Sign in or use an API key.");
        }

        IssueXsrfToken(http, antiforgery);
        return Results.Ok(UserStore.ToCurrentUser(user, userRecord));
    }

    private static async Task<IResult> ChangePassword(
        ChangePasswordRequest request,
        ClaimsPrincipal user,
        HttpContext http,
        UserStore userStore,
        IAntiforgery antiforgery,
        IMemoryCache cache,
        IOptions<AuthOptions> options,
        CancellationToken cancellationToken)
    {
        var userId = user.GetUserId();
        var userRecord = userId is null ? null : await userStore.FindByIdAsync(userId.Value, cancellationToken);
        if (userRecord is null)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "Only signed-in users can change their password.");
        }

        if (userRecord is not { AuthProvider: "Local", PasswordHash: not null })
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "This account signs in with an external identity provider.");
        }

        if (string.IsNullOrEmpty(request.CurrentPassword)
            || UserStore.Hasher.VerifyHashedPassword(userRecord, userRecord.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "The current password is not correct.");
        }

        if (UserStore.ValidatePassword(request.NewPassword, options.Value.MinPasswordLength) is { } error)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, error);
        }

        if (request.NewPassword == request.CurrentPassword)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "The new password must be different from the current one.");
        }

        await userStore.SetPasswordAsync(userRecord.Id, request.NewPassword!, mustChangePassword: false, changedBy: userRecord.Id, cancellationToken);
        SessionValidator.Forget(cache, userRecord.Id);

        // The security stamp changed: other sessions end, this one gets a fresh cookie.
        var updated = await userStore.FindByIdAsync(userRecord.Id, cancellationToken);
        await SignInAsync(http, antiforgery, await userStore.CreatePrincipalAsync(updated!, cancellationToken));
        return Results.NoContent();
    }

    private static IResult OidcLogin(string? returnUrl, IOptions<AuthOptions> options)
    {
        if (!options.Value.Oidc.Enabled)
        {
            return Results.NotFound();
        }

        return Results.Challenge(new AuthenticationProperties { RedirectUri = SafeReturnUrl(returnUrl) }, [AuthFeature.OidcScheme]);
    }

    /// <summary>Only local paths: prevents open redirects.</summary>
    public static string SafeReturnUrl(string? returnUrl) =>
        returnUrl is { Length: > 0 } && returnUrl[0] == '/' && !returnUrl.StartsWith("//", StringComparison.Ordinal)
            && !returnUrl.StartsWith("/\\", StringComparison.Ordinal)
            ? returnUrl
            : "/";

    private static async Task SignInAsync(HttpContext http, IAntiforgery antiforgery, ClaimsPrincipal principal)
    {
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
        http.User = principal;
        IssueXsrfToken(http, antiforgery);
    }

    /// <summary>Readable cookie with the antiforgery request token; Angular sends it back as X-XSRF-TOKEN.</summary>
    private static void IssueXsrfToken(HttpContext http, IAntiforgery antiforgery)
    {
        var tokens = antiforgery.GetAndStoreTokens(http);
        http.Response.Cookies.Append(XsrfCookieName, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = http.Request.IsHttps,
            Path = "/",
        });
    }

    private static IResult InvalidCredentials() =>
        ApiErrors.Result(StatusCodes.Status401Unauthorized, "Invalid username or password. After repeated failures, sign-in is blocked for a few minutes.");
}
