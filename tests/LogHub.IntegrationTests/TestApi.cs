using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace LogHub.IntegrationTests;

/// <summary>Helpers shared by the retention, alert and SMTP tests.</summary>
public static class TestApi
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>An HTTP client authenticated with a new API key holding the given permissions.</summary>
    public static async Task<HttpClient> CreateApiClientAsync(this LogHubFixture fixture, params string[] permissions)
    {
        var (_, token) = await fixture.CreateApiKeyAsync(permissions);
        var client = fixture.Factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", token);
        return client;
    }

    public static T GetService<T>(this LogHubFixture fixture)
        where T : notnull =>
        fixture.Factory.Services.GetRequiredService<T>();

    public static NpgsqlDataSource DataSource(this LogHubFixture fixture) => fixture.GetService<NpgsqlDataSource>();

    /// <summary>Posts CLEF lines to the Seq-compatible endpoint with an Ingest key.</summary>
    public static async Task IngestAsync(this LogHubFixture fixture, string token, params string[] clefLines)
    {
        using var client = fixture.Factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/events/raw")
        {
            Content = new StringContent(string.Join('\n', clefLines), Encoding.UTF8, "application/vnd.serilog.clef"),
        };
        request.Headers.Add("X-Seq-ApiKey", token);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    public static string Clef(DateTimeOffset timestamp, string message, string run, string level = "Information") =>
        JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["@t"] = timestamp.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            ["@m"] = message,
            ["@l"] = level,
            ["Run"] = run,
        });

    public static async Task<JsonElement> ReadJsonAsync(this HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        using var document = JsonDocument.Parse(body);
        return document.RootElement.Clone();
    }

    /// <summary>Asserts the status and the {"error": "..."} body.</summary>
    public static async Task AssertErrorAsync(this HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert.Equal(expected, response.StatusCode);
        var body = await response.ReadJsonAsync();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("error").GetString()));
    }
}
