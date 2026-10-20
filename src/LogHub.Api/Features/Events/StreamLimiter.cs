using System.Collections.Concurrent;
using System.Security.Claims;
using LogHub.Api.Common.Security;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Events;

/// <summary>Configuration section "Events".</summary>
public sealed class EventsOptions
{
    /// <summary>Live-tail streams one user (or API key) can keep open at the same time.</summary>
    public int MaxStreamsPerUser { get; set; } = 5;
}

/// <summary>Counts open live-tail streams per user or API key: each stream polls the database every second.</summary>
public sealed class StreamLimiter(IOptions<EventsOptions> options)
{
    private readonly ConcurrentDictionary<string, int> open = new();

    public static string Owner(ClaimsPrincipal user) =>
        user.GetUserId() is { } userId ? $"user:{userId}" : $"apikey:{user.GetApiKeyId()}";

    public bool TryAcquire(string owner)
    {
        while (true)
        {
            var current = open.GetValueOrDefault(owner);
            if (current >= options.Value.MaxStreamsPerUser)
            {
                return false;
            }

            if (current == 0 ? open.TryAdd(owner, 1) : open.TryUpdate(owner, current + 1, current))
            {
                return true;
            }
        }
    }

    public void Release(string owner)
    {
        while (open.TryGetValue(owner, out var current))
        {
            if (current <= 1 ? open.TryRemove(new KeyValuePair<string, int>(owner, current)) : open.TryUpdate(owner, current - 1, current))
            {
                return;
            }
        }
    }
}
