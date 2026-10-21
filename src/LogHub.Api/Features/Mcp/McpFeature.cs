using System.Threading.RateLimiting;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.RateLimiting;

namespace LogHub.Api.Features.Mcp;

public static class McpFeature
{
    public const string RateLimit = "mcp";

    public static IServiceCollection AddMcp(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddMcpServer(server => server.ServerInfo = new()
            { Name = "LogHub", Version = typeof(McpFeature).Assembly.GetName().Version?.ToString() ?? "1.0.0" })
            .WithHttpTransport(http => http.Stateless = true)
            .WithTools<LogHubTools>();
        var requestsPerMinute = configuration.GetValue("Mcp:RequestsPerMinute", 120);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(requestsPerMinute);
        services.AddRateLimiter(limiter => limiter.AddPolicy(RateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(LogHubClaims.ApiKeyId)?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = requestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0,
            })));
        return services;
    }

    public static WebApplication MapMcpEndpoint(this WebApplication app)
    {
        app.MapMcp("/mcp")
            .RequireAuthorization(policy => policy
                .AddAuthenticationSchemes(ApiKeyAuthenticationHandler.SchemeName)
                .RequireAuthenticatedUser()
                .RequireClaim(LogHubClaims.Permission, Permissions.Read))
            .RequireRateLimiting(RateLimit);
        return app;
    }
}
