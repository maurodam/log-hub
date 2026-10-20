using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Auth;

/// <summary>
/// Counts failed logins per (account, client IP). After Auth:MaxFailedLogins failures that IP cannot sign in to that
/// account for Auth:LockoutMinutes, while the owner can still sign in from elsewhere: an attacker cannot lock others out.
/// Kept in memory per replica; the account-wide threshold in the database covers distributed guessing.
/// </summary>
public sealed class LoginThrottle(IOptions<AuthOptions> options) : IDisposable
{
    private readonly MemoryCache failures = new(new MemoryCacheOptions { SizeLimit = 100_000 });

    public bool IsBlocked(long userId, string clientIp) =>
        failures.TryGetValue(Key(userId, clientIp), out int count) && count >= options.Value.MaxFailedLogins;

    public void RecordFailure(long userId, string clientIp)
    {
        var key = Key(userId, clientIp);
        var count = failures.TryGetValue(key, out int current) ? current + 1 : 1;
        failures.Set(key, count, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(options.Value.LockoutMinutes),
            Size = 1,
        });
    }

    public void Reset(long userId, string clientIp) => failures.Remove(Key(userId, clientIp));

    public void Dispose() => failures.Dispose();

    private static string Key(long userId, string clientIp) => $"{userId}|{clientIp}";
}
