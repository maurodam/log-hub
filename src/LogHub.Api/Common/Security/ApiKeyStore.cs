using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;

namespace LogHub.Api.Common.Security;

public sealed record ApiKeyInfo
{
    public long Id { get; init; }

    public string[] Permissions { get; init; } = [];

    public string? MinimumLevel { get; init; }

    public string AppliedProperties { get; init; } = "{}";

    public bool UseServerTimestamps { get; init; }

    public bool Can(string permission) => Permissions.Contains(permission, StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Finds API keys by token. Tokens are stored as SHA-256 hashes. Results (also misses) are cached briefly,
/// so a flood of requests with a wrong key does not reach the database. The cache has a size limit:
/// random tokens cannot grow memory without bound.
/// </summary>
public sealed class ApiKeyStore(NpgsqlDataSource dataSource) : IDisposable
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(30);

    private readonly MemoryCache cache = new(new MemoryCacheOptions { SizeLimit = 10_000 });

    private const string SelectColumns = """
        select id, permissions, minimum_level, applied_properties::text as applied_properties, use_server_timestamps
        from api_key
        """;

    /// <summary>Drops a cached key after it was changed or deleted.</summary>
    public void Evict(string tokenHash) => cache.Remove($"apikey:{tokenHash}");

    public void Dispose() => cache.Dispose();

    public static string HashToken(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public Task<ApiKeyInfo?> FindByTokenAsync(string token, CancellationToken cancellationToken)
    {
        var tokenHash = HashToken(token);
        return GetCachedAsync($"apikey:{tokenHash}", $"""{SelectColumns} where token_hash = @tokenHash""", new { tokenHash }, cancellationToken);
    }

    /// <summary>The default key holds the input settings for events sent without a key.</summary>
    public Task<ApiKeyInfo?> FindDefaultAsync(CancellationToken cancellationToken) =>
        GetCachedAsync("apikey:default", $"""{SelectColumns} where is_default """, null, cancellationToken);

    private async Task<ApiKeyInfo?> GetCachedAsync(string cacheKey, string sql, object? parameters, CancellationToken cancellationToken) =>
        await cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = CacheDuration;
            entry.Size = 1;
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            return await connection.QuerySingleOrDefaultAsync<ApiKeyInfo>(
                new CommandDefinition(sql, parameters, cancellationToken: cancellationToken));
        });
}
