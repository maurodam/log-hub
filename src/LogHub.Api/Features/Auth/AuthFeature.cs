using System.Threading.RateLimiting;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace LogHub.Api.Features.Auth;

/// <summary>
/// Authentication for /api/v1:
/// - browser sessions: HttpOnly, Secure, SameSite=Strict cookie with sliding expiration, revoked through the account security stamp;
///   unsafe methods need the antiforgery token (see <see cref="ApiGuardFilter"/>);
/// - API keys: X-Api-Key header (selected automatically when present);
/// - optional OpenID Connect (Microsoft Entra ID) that ends in the same session cookie.
/// Local logins are rate limited per client IP and lock the account after repeated failures.
/// </summary>
public static class AuthFeature
{
    public const string PolicyScheme = "LogHub";
    public const string OidcScheme = OpenIdConnectDefaults.AuthenticationScheme;
    public const string LoginRateLimit = "login";

    public static IServiceCollection AddLogHubAuthentication(this IServiceCollection services, IConfiguration configuration, IWebHostEnvironment environment)
    {
        services.Configure<AuthOptions>(configuration.GetSection("Auth"));
        var options = configuration.GetSection("Auth").Get<AuthOptions>() ?? new AuthOptions();
        var securePolicy = environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;

        services.AddMemoryCache();
        services.AddSingleton<UserStore>();
        services.AddSingleton<SessionValidator>();
        services.AddSingleton<LoginThrottle>();

        services.AddAntiforgery(antiforgery =>
        {
            antiforgery.HeaderName = "X-XSRF-TOKEN";
            antiforgery.Cookie.Name = "loghub.antiforgery";
            antiforgery.Cookie.SameSite = SameSiteMode.Strict;
            // Follows the request scheme: antiforgery refuses to run on HTTP with "Always".
            // The session cookie below stays Secure, so sessions still need HTTPS (or localhost).
            antiforgery.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            antiforgery.SuppressXFrameOptionsHeader = true;
        });

        var authentication = services
            .AddAuthentication(authentication =>
            {
                authentication.DefaultScheme = PolicyScheme;
                authentication.DefaultChallengeScheme = PolicyScheme;
                authentication.DefaultForbidScheme = PolicyScheme;
            })
            .AddPolicyScheme(PolicyScheme, displayName: null, policy => policy.ForwardDefaultSelector = context =>
                ApiKeyAuthenticationHandler.HasApiKey(context.Request)
                    ? ApiKeyAuthenticationHandler.SchemeName
                    : CookieAuthenticationDefaults.AuthenticationScheme)
            .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(ApiKeyAuthenticationHandler.SchemeName, configureOptions: null)
            .AddCookie(CookieAuthenticationDefaults.AuthenticationScheme, cookie =>
            {
                cookie.Cookie.Name = "loghub.session";
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Strict;
                cookie.Cookie.SecurePolicy = securePolicy;
                cookie.ExpireTimeSpan = TimeSpan.FromHours(options.SessionHours);
                cookie.SlidingExpiration = true;
                cookie.EventsType = typeof(SessionValidator);
            });

        if (options.Oidc.Enabled)
        {
            if (options.Oidc.IsMultiTenantAuthority && options.Oidc.AllowedTenants.Length == 0)
            {
                throw new InvalidOperationException(
                    "Auth:Oidc:Authority is multi-tenant: set Auth:Oidc:AllowedTenants, or use https://login.microsoftonline.com/{tenant-id}/v2.0.");
            }

            authentication.AddOpenIdConnect(OidcScheme, oidc =>
            {
                if (options.Oidc.IsMultiTenantAuthority)
                {
                    // The multi-tenant metadata has a "{tenantid}" issuer template: accept only the allowed tenants.
                    oidc.TokenValidationParameters.ValidIssuers =
                        options.Oidc.AllowedTenants.Select(tenant => $"https://login.microsoftonline.com/{tenant}/v2.0").ToArray();
                }

                oidc.Authority = options.Oidc.Authority;
                oidc.ClientId = options.Oidc.ClientId;
                oidc.ClientSecret = options.Oidc.ClientSecret;
                oidc.ResponseType = OpenIdConnectResponseType.Code;
                oidc.UsePkce = true;
                oidc.CallbackPath = options.Oidc.CallbackPath;
                oidc.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                oidc.SaveTokens = false;
                oidc.MapInboundClaims = false;
                oidc.Scope.Clear();
                oidc.Scope.Add("openid");
                oidc.Scope.Add("profile");
                oidc.Scope.Add("email");
                oidc.Events.OnTokenValidated = OidcUserMapper.OnTokenValidated;
                oidc.Events.OnRemoteFailure = context =>
                {
                    context.Response.Redirect("/login?error=oidc");
                    context.HandleResponse();
                    return Task.CompletedTask;
                };
            });
        }

        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.AddPolicy(LoginRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = options.LoginAttemptsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            limiter.OnRejected = (context, _) => new ValueTask(ApiErrors.WriteAsync(
                context.HttpContext,
                StatusCodes.Status429TooManyRequests,
                context.HttpContext.Request.Path.StartsWithSegments("/api/v1/auth/login")
                    ? "Too many login attempts. Wait a minute and retry."
                    : "Too many requests. Retry later."));
        });

        return services;
    }

    public static RouteGroupBuilder MapAuth(this RouteGroupBuilder api) => api.MapAuthEndpoints();
}
