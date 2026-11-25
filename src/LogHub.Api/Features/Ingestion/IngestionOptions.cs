namespace LogHub.Api.Features.Ingestion;

/// <summary>Configuration section "Ingestion".</summary>
public sealed class IngestionOptions
{
    /// <summary>When true, requests without an API key are rejected with 401.</summary>
    public bool RequireApiKey { get; set; } = true;

    public int MaxPayloadBytes { get; set; } = 10 * 1024 * 1024;

    public int MaxEventBytes { get; set; } = 512 * 1024;

    /// <summary>Ingestion requests processed at the same time; others wait briefly, then get 429.</summary>
    public int MaxConcurrentRequests { get; set; } = 32;
}
