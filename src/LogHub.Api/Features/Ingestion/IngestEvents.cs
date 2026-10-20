using System.Buffers;
using System.Text.Json;
using LogHub.Api.Common.Security;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// POST /api/events/raw and POST /ingest/clef: Seq-compatible ingestion used by Serilog.Sinks.Seq.
/// API key: X-Seq-ApiKey header or ?apiKey= query. Success: 201 {"MinimumLevelAccepted":null|"Level"}.
/// The response JSON stays compact: the Serilog sink looks for the exact text "MinimumLevelAccepted":".
/// </summary>
public static class IngestEvents
{
    private const string ClefContentType = "application/vnd.serilog.clef";

    public static IEndpointRouteBuilder MapIngestion(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/events/raw", Handle).RequireRateLimiting(IngestionFeature.RateLimit);
        app.MapPost("/ingest/clef", Handle).RequireRateLimiting(IngestionFeature.RateLimit);
        return app;
    }

    private static async Task<IResult> Handle(
        HttpContext context,
        ApiKeyStore apiKeys,
        EventQueue queue,
        IOptions<IngestionOptions> options,
        ILogger<IngestionBatch> logger,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var request = context.Request;
        var arrived = DateTimeOffset.UtcNow;

        var token = request.Headers["X-Seq-ApiKey"].FirstOrDefault() ?? request.Query["apiKey"].FirstOrDefault();
        ApiKeyInfo? apiKey;
        if (!string.IsNullOrEmpty(token))
        {
            apiKey = await apiKeys.FindByTokenAsync(token, cancellationToken);
            if (apiKey is null)
            {
                return Error(StatusCodes.Status401Unauthorized, "The API key is not valid.");
            }

            if (!apiKey.Can(Permissions.Ingest))
            {
                return Error(StatusCodes.Status403Forbidden, "The API key does not have the Ingest permission.");
            }
        }
        else
        {
            if (settings.RequireApiKey)
            {
                return Error(StatusCodes.Status401Unauthorized, "An API key is required to write events.");
            }

            apiKey = await apiKeys.FindDefaultAsync(cancellationToken);
        }

        if (request.ContentLength > settings.MaxPayloadBytes)
        {
            return Error(StatusCodes.Status413PayloadTooLarge, $"The payload is larger than {settings.MaxPayloadBytes} bytes.");
        }

        var payload = await ReadBodyAsync(request.Body, settings.MaxPayloadBytes, cancellationToken);
        if (payload is null)
        {
            return Error(StatusCodes.Status413PayloadTooLarge, $"The payload is larger than {settings.MaxPayloadBytes} bytes.");
        }

        var minimumRank = LogLevels.TryRank(apiKey?.MinimumLevel);
        var accepted = Accepted(minimumRank);

        // The sink posts an empty body to poll the minimum level.
        if (payload.Value.IsEmpty)
        {
            return accepted;
        }

        List<IngestedEvent> events;
        try
        {
            var isClef = request.ContentType?.StartsWith(ClefContentType, StringComparison.OrdinalIgnoreCase) == true
                || request.Query.ContainsKey("clef");
            using var applied = JsonDocument.Parse(apiKey?.AppliedProperties ?? "{}");
            events = ClefReader.Read(payload.Value, isClef, settings.MaxEventBytes, applied.RootElement);
        }
        catch (InvalidPayloadException ex)
        {
            logger.LogWarning("Rejected invalid payload from API key {ApiKeyId}: {Reason}", apiKey?.Id, ex.Message);
            return Error(StatusCodes.Status400BadRequest, ex.Message);
        }

        if (minimumRank is { } minimum)
        {
            events.RemoveAll(e => e.LevelRank < minimum);
        }

        if (apiKey?.UseServerTimestamps == true)
        {
            events = events.ConvertAll(e => e with { Timestamp = arrived });
        }

        if (events.Count > 0 && !queue.TryEnqueue(new IngestionBatch(apiKey?.Id, arrived, events)))
        {
            return Error(StatusCodes.Status503ServiceUnavailable, "The server is busy. Retry later.");
        }

        return accepted;
    }

    private static IResult Accepted(short? minimumRank) => Results.Text(
        JsonSerializer.Serialize(new { MinimumLevelAccepted = minimumRank is { } rank ? LogLevels.Name(rank) : null }),
        "application/json",
        statusCode: StatusCodes.Status201Created);

    private static IResult Error(int statusCode, string message) => Results.Text(
        JsonSerializer.Serialize(new { Error = message }),
        "application/json",
        statusCode: statusCode);

    /// <summary>Reads the body up to <paramref name="maxBytes"/>; returns null when the body is larger.</summary>
    private static async Task<ReadOnlyMemory<byte>?> ReadBodyAsync(Stream body, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = ArrayPool<byte>.Shared.Rent(81920);
        try
        {
            int read;
            while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > maxBytes)
                {
                    return null;
                }

                buffer.Write(chunk, 0, read);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(chunk);
        }

        return new ReadOnlyMemory<byte>(buffer.GetBuffer(), 0, (int)buffer.Length);
    }
}
