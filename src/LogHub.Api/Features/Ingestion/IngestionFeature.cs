using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.RateLimiting;

namespace LogHub.Api.Features.Ingestion;

public static class IngestionFeature
{
    public const string RateLimit = "ingestion";

    public static IServiceCollection AddIngestion(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<IngestionOptions>(configuration.GetSection("Ingestion"));
        var options = configuration.GetSection("Ingestion").Get<IngestionOptions>() ?? new IngestionOptions();
        services.AddRateLimiter(limiter => limiter.AddConcurrencyLimiter(RateLimit, concurrency =>
        {
            concurrency.PermitLimit = options.MaxConcurrentRequests;
            concurrency.QueueLimit = options.MaxConcurrentRequests * 4;
        }));
        services.AddMemoryCache();
        services.AddSingleton<ApiKeyStore>();
        services.AddSingleton<EventQueue>();
        services.AddHostedService<EventWriter>();
        return services;
    }
}
