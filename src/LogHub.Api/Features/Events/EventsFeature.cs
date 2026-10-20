using LogHub.Api.Common.Security;

namespace LogHub.Api.Features.Events;

public static class EventsFeature
{
    public static IServiceCollection AddEvents(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<EventsOptions>(configuration.GetSection("Events"));
        services.AddSingleton<StreamLimiter>();
        return services.AddSingleton<EventFilterBuilder>();
    }

    public static RouteGroupBuilder MapEvents(this RouteGroupBuilder api)
    {
        var events = api.MapGroup("/events").RequireAuthorization(Policies.Read);
        events.MapGet("/", ListEvents.Handle);
        events.MapGet("/stream", StreamEvents.Handle);
        events.MapGet("/{id:long}", GetEvent.Handle);
        return api;
    }
}
