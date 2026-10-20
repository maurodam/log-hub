using System.Security.Cryptography;
using System.Net.Http.Json;
using Dapper;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Testcontainers.PostgreSql;

namespace LogHub.IntegrationTests;

public sealed record StoredEvent(
    long Id,
    DateTime Timestamp,
    string Level,
    short LevelRank,
    string? MessageTemplate,
    string? Message,
    string? Exception,
    long EventType,
    string Properties);

/// <summary>Starts PostgreSQL in Docker and LogHub in memory (migrations run at startup).</summary>
public sealed class LogHubFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:17-alpine").Build();
    private WebApplicationFactory<Program>? factory;
    private NpgsqlDataSource? dataSource;

    public const string AdminUsername = "admin";
    public const string AdminPassword = "Admin-Password-For-Tests-1";

    public WebApplicationFactory<Program> Factory => factory ?? throw new InvalidOperationException("Fixture is not initialized.");

    private NpgsqlDataSource DataSource => dataSource ?? throw new InvalidOperationException("Fixture is not initialized.");

    public async ValueTask InitializeAsync()
    {
        await database.StartAsync();
        var connectionString = database.GetConnectionString();
        dataSource = NpgsqlDataSource.Create(connectionString);

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder
            .UseEnvironment("Testing")
            .UseSetting("ConnectionStrings:LogHub", connectionString)
            .UseSetting("Ingestion:RequireApiKey", "true")
            .UseSetting("Auth:AdminPassword", AdminPassword)
            .UseSetting("Auth:LoginAttemptsPerMinute", "1000"));

        _ = factory.Server;
    }

    public async ValueTask DisposeAsync()
    {
        if (factory is not null)
        {
            await factory.DisposeAsync();
        }

        if (dataSource is not null)
        {
            await dataSource.DisposeAsync();
        }

        await database.DisposeAsync();
    }

    /// <summary>
    /// Signs in through POST /api/v1/auth/login and returns a client that keeps the session cookie
    /// and sends the CSRF header, like the browser app. HTTPS base address: the session cookie is Secure.
    /// </summary>
    public async Task<HttpClient> CreateSessionClientAsync(string username = AdminUsername, string password = AdminPassword)
    {
        var client = Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        using var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { username, password }, TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", XsrfToken(response));
        return client;
    }

    /// <summary>Reads the XSRF-TOKEN cookie value from a response.</summary>
    public static string XsrfToken(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie")
            .Select(cookie => cookie.Split(';')[0])
            .Where(pair => pair.StartsWith("XSRF-TOKEN=", StringComparison.Ordinal))
            .Select(pair => Uri.UnescapeDataString(pair["XSRF-TOKEN=".Length..]))
            .Last();

    public async Task<(long Id, string Token)> CreateApiKeyAsync(string[] permissions, string? minimumLevel = null, string appliedProperties = "{}")
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        await using var connection = await DataSource.OpenConnectionAsync(TestContext.Current.CancellationToken);
        var id = await connection.ExecuteScalarAsync<long>(
            """
            insert into api_key (title, token_hash, token_prefix, permissions, minimum_level, applied_properties)
            values ('test', @tokenHash, @tokenPrefix, @permissions, @minimumLevel, @appliedProperties::jsonb)
            returning id
            """,
            new { tokenHash = ApiKeyStore.HashToken(token), tokenPrefix = token[..4], permissions, minimumLevel, appliedProperties });
        return (id, token);
    }

    /// <summary>Polls until the API key has at least <paramref name="expected"/> stored events (writes are asynchronous).</summary>
    public async Task<List<StoredEvent>> WaitForEventsAsync(long apiKeyId, int expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            await using var connection = await DataSource.OpenConnectionAsync(TestContext.Current.CancellationToken);
            var events = (await connection.QueryAsync<StoredEvent>(
                """
                select id, timestamp, level, level_rank, message_template, message, exception, event_type, properties::text as properties
                from event
                where api_key_id = @apiKeyId
                order by timestamp, id
                """,
                new { apiKeyId })).AsList();

            if (events.Count >= expected || DateTime.UtcNow > deadline)
            {
                return events;
            }

            await Task.Delay(100, TestContext.Current.CancellationToken);
        }
    }
}

/// <summary>
/// All integration tests share one LogHub host: the Serilog bootstrap logger in Program
/// can be frozen only once per process.
/// </summary>
[CollectionDefinition(Name)]
public sealed class LogHubCollection : ICollectionFixture<LogHubFixture>
{
    public const string Name = "LogHub";
}
