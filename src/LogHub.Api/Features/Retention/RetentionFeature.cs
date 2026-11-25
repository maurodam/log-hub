using LogHub.Api.Common.Security;

namespace LogHub.Api.Features.Retention;

/// <summary>Retention policies, partition maintenance and storage info. See docs/api/v1.md (Retention).</summary>
public static class RetentionFeature
{
    public static IServiceCollection AddRetention(this IServiceCollection services, IConfiguration configuration, bool runInBackground = true)
    {
        services.Configure<RetentionOptions>(configuration.GetSection("Retention"));
        services.AddSingleton<RetentionService>();
        if (runInBackground)
        {
            services.AddHostedService(provider => provider.GetRequiredService<RetentionService>());
        }
        return services;
    }

    public static RouteGroupBuilder MapRetention(this RouteGroupBuilder api, bool usePersistentTrigger = false)
    {
        var retention = api.MapGroup("/retention").RequireAuthorization(Policies.Project);
        retention.MapGet("/", RetentionPolicies.List);
        retention.MapPost("/", RetentionPolicies.Create);
        retention.MapPut("/{id:long}", RetentionPolicies.Update);
        retention.MapDelete("/{id:long}", RetentionPolicies.Delete);
        if (usePersistentTrigger)
        {
            retention.MapPost("/run", async (RetentionService service, CancellationToken ct) =>
            {
                await service.RequestRunAsync(ct);
                return Results.Accepted();
            });
        }
        else
        {
            retention.MapPost("/run", RunRetention);
        }
        retention.MapGet("/storage", RetentionStorage.Handle);
        return api;
    }

    /// <summary>POST /api/v1/retention/run: starts the job in the background.</summary>
    private static IResult RunRetention(RetentionService service)
    {
        service.Trigger();
        return Results.Accepted();
    }
}

/// <summary>Configuration section "Retention".</summary>
public sealed class RetentionOptions
{
    /// <summary>Minutes between two runs of the retention job.</summary>
    public int IntervalMinutes { get; set; } = 60;

    /// <summary>Delay before the first run after startup.</summary>
    public int InitialDelaySeconds { get; set; } = 60;

    /// <summary>
    /// Retention__DefaultDays: keep events this many days (1-3650). At startup LogHub creates or updates the all-events
    /// policy with this value; the policy is then read-only in the UI and API. Empty or 0: the policy is managed in the UI.
    /// </summary>
    public int? DefaultDays { get; set; }

    public bool ManagesAllEventsPolicy => DefaultDays is > 0;
}
