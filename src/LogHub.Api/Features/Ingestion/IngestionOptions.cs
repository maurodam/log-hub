namespace LogHub.Api.Features.Ingestion;

/// <summary>Configuration section "Ingestion".</summary>
public sealed class IngestionOptions
{
    /// <summary>When true, requests without an API key are rejected with 401.</summary>
    public bool RequireApiKey { get; set; } = true;

    public int MaxPayloadBytes { get; set; } = 10 * 1024 * 1024;

    public int MaxEventBytes { get; set; } = 512 * 1024;

    /// <summary>Maximum number of accepted events waiting to be written (bounds memory). When reached, ingestion answers 503.</summary>
    public int MaxQueuedEvents { get; set; } = 200_000;

    /// <summary>Ingestion requests processed at the same time; others wait briefly, then get 429 (bounds request buffers).</summary>
    public int MaxConcurrentRequests { get; set; } = 32;

    /// <summary>Events written to PostgreSQL in one COPY operation (approximate upper bound).</summary>
    public int WriteBatchSize { get; set; } = 5000;
}
