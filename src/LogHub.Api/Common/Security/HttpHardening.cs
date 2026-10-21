using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;

namespace LogHub.Api.Common.Security;

/// <summary>
/// Reverse proxy support and security headers.
/// Proxy:TrustForwardedHeaders = true behind Azure Container Apps / App Service / a reverse proxy that sets
/// X-Forwarded-For and X-Forwarded-Proto (needed for client IPs, HTTPS redirects and OIDC callback URLs).
/// Leave it false when LogHub is exposed directly: clients could forge those headers.
/// </summary>
public static class HttpHardening
{
    private const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    public static IServiceCollection AddHttpHardening(this IServiceCollection services, IConfiguration configuration)
    {
        if (configuration.GetValue("Proxy:TrustForwardedHeaders", false))
        {
            services.Configure<ForwardedHeadersOptions>(forwarded =>
            {
                forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
                forwarded.KnownIPNetworks.Clear();
                forwarded.KnownProxies.Clear();
            });
        }

        services.Configure<KestrelServerOptions>(kestrel => kestrel.AddServerHeader = false);

        services.AddHsts(hsts =>
        {
            hsts.MaxAge = TimeSpan.FromDays(365);
            hsts.IncludeSubDomains = true;
        });

        return services;
    }

    public static WebApplication UseHttpHardening(this WebApplication app)
    {
        if (app.Configuration.GetValue("Proxy:TrustForwardedHeaders", false))
        {
            app.UseForwardedHeaders();
        }

        if (!app.Environment.IsDevelopment())
        {
            app.UseHsts();
        }

        app.Use((context, next) =>
        {
            var headers = context.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers.XFrameOptions = "DENY";
            headers.ContentSecurityPolicy = ContentSecurityPolicy;
            headers["Referrer-Policy"] = "no-referrer";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
            headers["Cross-Origin-Opener-Policy"] = "same-origin";

            // API responses hold log data, user details and freshly created API keys: never cache them.
            if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/mcp"))
            {
                headers.CacheControl = "no-store";
            }

            return next(context);
        });

        return app;
    }
}
