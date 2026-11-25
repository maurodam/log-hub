using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using LogHub.Api.Features.Alerts;
using LogHub.Api.Features.Alerts.Webhooks;
using LogHub.Api.Features.Retention;

namespace LogHub.Api.Features.Scheduling;

internal sealed class JobScheduler
{
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(4);
    private readonly byte[] secretHash;

    private JobScheduler(string secret) => secretHash = Hash(secret);

    public static JobScheduler? FromConfiguration(IConfiguration configuration)
    {
        if (!configuration.GetValue<bool>("LogHub:SchedulerEnabled"))
        {
            return null;
        }

        var secret = configuration["LogHub:SchedulerSecret"];
        if (secret is not { Length: >= 32 } || secret.Any(char.IsWhiteSpace))
        {
            throw new InvalidOperationException("Set LogHub__SchedulerSecret to a random token of at least 32 characters with no whitespace.");
        }

        return new JobScheduler(secret);
    }

    public void MapEndpoints(WebApplication app)
    {
        var jobs = app.MapGroup("/api/internal/jobs").AddEndpointFilter(async (context, next) =>
        {
            var header = context.HttpContext.Request.Headers.Authorization;
            if (header.Count != 1 || !AuthenticationHeaderValue.TryParse(header[0], out var authorization)
                || !authorization.Scheme.Equals("Bearer", StringComparison.OrdinalIgnoreCase)
                || authorization.Parameter is null
                || !CryptographicOperations.FixedTimeEquals(Hash(authorization.Parameter), secretHash))
            {
                return Results.Unauthorized();
            }

            return await next(context);
        });

        jobs.MapPost("/alerts", (AlertService alerts, CancellationToken ct) =>
            RunAsync(token => alerts.RunOnceAsync(token, skipIfRunning: true), ct));
        jobs.MapPost("/webhooks", (WebhookDelivery delivery, CancellationToken ct) =>
            RunAsync(async token =>
            {
                while (await delivery.RunOnceAsync(token))
                {
                    token.ThrowIfCancellationRequested();
                }
            }, ct));
        jobs.MapPost("/retention", (RetentionService retention, CancellationToken ct) =>
            RunAsync(retention.RunScheduledAsync, ct));
    }

    private static async Task<IResult> RunAsync(Func<CancellationToken, Task> job, CancellationToken requestAborted)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        timeout.CancelAfter(JobTimeout);
        try
        {
            await job(timeout.Token);
            return Results.NoContent();
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested && !requestAborted.IsCancellationRequested)
        {
            return Results.StatusCode(StatusCodes.Status504GatewayTimeout);
        }
    }

    private static byte[] Hash(string value) => SHA256.HashData(Encoding.UTF8.GetBytes(value));
}
