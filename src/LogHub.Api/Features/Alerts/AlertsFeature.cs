using System.Threading.RateLimiting;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts.Email;
using Microsoft.AspNetCore.RateLimiting;

namespace LogHub.Api.Features.Alerts;

/// <summary>Email alerts, notification history and SMTP settings. See docs/api/v1.md (Email notifications).</summary>
public static class AlertsFeature
{
    /// <summary>Test emails per user per minute (alerts and SMTP settings).</summary>
    public const string TestEmailRateLimit = "test-email";

    public static IServiceCollection AddAlerts(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AlertOptions>(configuration.GetSection("Alerts"));
        services.AddSingleton<SmtpSettingsStore>();
        services.AddSingleton<IEmailSender, MailKitEmailSender>();
        services.AddSingleton<AlertService>();
        services.AddHostedService(provider => provider.GetRequiredService<AlertService>());
        services.AddRateLimiter(limiter => limiter.AddPolicy(TestEmailRateLimit, context => RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(LogHubClaims.UserId)?.Value ?? context.User.FindFirst(LogHubClaims.ApiKeyId)?.Value ?? "anonymous",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
        return services;
    }

    public static RouteGroupBuilder MapAlerts(this RouteGroupBuilder api)
    {
        var smtp = api.MapGroup("/settings/smtp").RequireAuthorization(Policies.System);
        smtp.MapGet("/", SmtpSettingsEndpoints.Get);
        smtp.MapPut("/", SmtpSettingsEndpoints.Update);
        smtp.MapPost("/test", SmtpSettingsEndpoints.Test).RequireRateLimiting(TestEmailRateLimit);

        var alerts = api.MapGroup("/alerts");
        alerts.MapGet("/", AlertEndpoints.List).RequireAuthorization(Policies.Read);
        alerts.MapPost("/", AlertEndpoints.Create).RequireAuthorization(Policies.Project);
        alerts.MapPut("/{id:long}", AlertEndpoints.Update).RequireAuthorization(Policies.Project);
        alerts.MapDelete("/{id:long}", AlertEndpoints.Delete).RequireAuthorization(Policies.Project);
        alerts.MapPost("/{id:long}/test", AlertEndpoints.Test).RequireAuthorization(Policies.Project).RequireRateLimiting(TestEmailRateLimit);
        alerts.MapGet("/{id:long}/notifications", AlertEndpoints.Notifications).RequireAuthorization(Policies.Read);
        return api;
    }
}
