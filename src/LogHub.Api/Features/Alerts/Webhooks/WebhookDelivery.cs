using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Alerts.Webhooks;

public sealed class WebhookDelivery(
    NpgsqlDataSource dataSource,
    IDataProtectionProvider protection,
    IOptions<WebhookOptions> options,
    IHttpClientFactory clients,
    ILogger<WebhookDelivery> logger) : BackgroundService
{
    private const int MaxAttempts = 4;
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(24);

    public const string ClientName = "LogHubWebhooks";

    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        UseCookies = false,
        ActivityHeadersPropagator = null,
        PooledConnectionLifetime = TimeSpan.FromMinutes(1),
        ConnectCallback = ConnectPublicAsync,
    };

    public static async Task<long?> Enqueue(
        NpgsqlConnection db, long alertId, long? destinationId, long count, DateTime now, CancellationToken ct)
    {
        var ids = await db.QueryAsync<long>(new CommandDefinition(
            """
            insert into webhook_delivery (alert_id, destination_id, destination_name, kind, alert_title,
                window_start, created_at, event_count, is_test, next_attempt)
            select a.id, d.id, d.name, d.kind, a.title, @now - make_interval(mins => a.window_minutes), @now,
                @count, @destinationId is not null, @now
            from alert a join webhook_destination d on d.id = any(a.webhook_destination_ids)
            where a.id = @alertId and d.enabled and not d.deleted
              and ((@destinationId is not null and d.id = @destinationId)
                or (@destinationId is null and a.is_enabled and @count >= a.threshold and not exists (
                    select 1 from webhook_delivery w where w.alert_id = a.id and w.destination_id = d.id
                    and not w.is_test and w.status <> 'Cancelled'
                    and w.created_at > @now - make_interval(mins => a.suppression_minutes)
                )))
            order by d.id
            for share of a, d
            on conflict do nothing
            returning id
            """, new { alertId, destinationId, count, now }, cancellationToken: ct));
        return ids.Select(id => (long?)id).FirstOrDefault();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                while (await RunOnceAsync(stoppingToken))
                {
                    stoppingToken.ThrowIfCancellationRequested();
                }
            }
            catch (Exception) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning("Webhook delivery worker failed. Pending deliveries will be retried.");
            }
        }
    }

    public async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        var lease = Guid.NewGuid();
        Delivery? delivery;
        await using (var db = await dataSource.OpenConnectionAsync(ct))
        {
            await db.ExecuteAsync(new CommandDefinition(
                """
                update webhook_delivery set status = 'Failed', error = 'Retry budget exhausted', lease_id = null
                where status = 'Pending' and next_attempt <= now()
                  and (attempts >= @maxAttempts or created_at <= now() - interval '24 hours')
                """, new { MaxAttempts }, cancellationToken: ct));
            delivery = await db.QuerySingleOrDefaultAsync<Delivery>(new CommandDefinition(
                """
                with due as (
                    select id from webhook_delivery
                    where status = 'Pending' and next_attempt <= now() and attempts < @maxAttempts
                      and created_at > now() - interval '24 hours'
                    order by next_attempt, id limit 1 for update skip locked
                )
                update webhook_delivery w set attempts = w.attempts + 1, next_attempt = now() + interval '30 seconds',
                    lease_id = @lease
                from due, webhook_destination d
                where w.id = due.id and d.id = w.destination_id and d.enabled and not d.deleted
                returning w.id, w.alert_id, w.alert_title, w.kind, w.window_start, w.created_at, w.event_count,
                    w.is_test, w.attempts, d.protected_url, d.protected_secret
                """, new { lease, MaxAttempts }, cancellationToken: ct));
        }

        if (delivery is null)
        {
            return false;
        }

        var result = await SendAsync(delivery, ct);
        var now = DateTime.UtcNow;
        var next = now.AddSeconds(delivery.Attempts switch { 1 => 15, 2 => 60, _ => 300 });
        if (result.RetryAfter > next)
        {
            next = result.RetryAfter.Value;
        }
        var retry = result.Transient && delivery.Attempts < MaxAttempts && next < delivery.CreatedAt + Lifetime;
        var status = result.Error is null ? "Sent" : retry ? "Pending" : "Failed";
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var updated = await connection.ExecuteAsync(new CommandDefinition(
            """
            update webhook_delivery set status = @status, error = @error, next_attempt = @next, lease_id = null
            where id = @id and lease_id = @lease and status = 'Pending'
            """, new { delivery.Id, lease, status, result.Error, next }, cancellationToken: ct));
        if (updated > 0 && status == "Failed")
        {
            logger.LogWarning("Webhook delivery {DeliveryId} failed after {Attempts} attempts: {Error}",
                delivery.Id, delivery.Attempts, result.Error);
        }
        return true;
    }

    private async Task<Outcome> SendAsync(Delivery job, CancellationToken ct)
    {
        try
        {
            var protector = protection.CreateProtector(WebhookEndpoints.ProtectionPurpose);
            if (!options.Value.TryDestination(job.Kind, protector.Unprotect(job.ProtectedUrl), out var uri))
            {
                return new("Destination is invalid or its host is no longer allowed.");
            }

            string? link = null;
            if (Uri.TryCreate(options.Value.PublicUrl, UriKind.Absolute, out var baseUri) && baseUri.Scheme == Uri.UriSchemeHttps)
            {
                link = new Uri(baseUri, "/alerts").AbsoluteUri;
            }

            var title = job.IsTest ? "LogHub test notification" : job.AlertTitle;
            var summary = $"{title} · {job.EventCount} events · {job.WindowStart:u} – {job.CreatedAt:u}";
            object payload = job.Kind switch
            {
                "slack" => new { text = EscapeSlack(summary) + (link is null ? "" : $"\n<{EscapeSlack(link)}|Open LogHub>"), mrkdwn = true, unfurl_links = false, unfurl_media = false },
                "teams" => new
                {
                    type = "message",
                    attachments = new[]
                    {
                        new
                        {
                            contentType = "application/vnd.microsoft.card.adaptive",
                            contentUrl = (string?)null,
                            content = new
                            {
                                type = "AdaptiveCard", version = "1.2",
                                body = new[] { new { type = "TextBlock", text = summary, wrap = true } },
                                actions = link is null ? [] : new[] { new { type = "Action.OpenUrl", title = "Open LogHub", url = link } },
                            },
                        },
                    },
                },
                _ => new
                {
                    version = 1, deliveryId = job.Id, alertId = job.AlertId, title,
                    windowStart = job.WindowStart, windowEnd = job.CreatedAt, eventCount = job.EventCount, job.IsTest, url = link,
                },
            };
            var body = JsonSerializer.Serialize(payload, JsonSerializerOptions.Web);
            using var request = new HttpRequestMessage(HttpMethod.Post, uri) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            if (job.Kind == "generic")
            {
                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
                var secret = protector.Unprotect(job.ProtectedSecret!);
                var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{timestamp}.{body}"));
                request.Headers.Add("X-LogHub-Timestamp", timestamp);
                request.Headers.Add("X-LogHub-Signature", $"sha256={Convert.ToHexStringLower(signature)}");
            }

            using var client = clients.CreateClient(ClientName);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            var code = (int)response.StatusCode;
            var after = response.Headers.RetryAfter;
            var retryAfter = after?.Date?.UtcDateTime ?? (after?.Delta is { } delta ? DateTime.UtcNow + delta : (DateTime?)null);
            return response.IsSuccessStatusCode ? new(null) : new($"HTTP {code}", code is 408 or 429 or >= 500, retryAfter);
        }
        catch (CryptographicException)
        {
            return new("The stored webhook credentials could not be decrypted.");
        }
        catch (HttpRequestException ex)
        {
            return ex.InnerException is BlockedAddressException
                ? new("The destination did not resolve exclusively to public addresses.")
                : new("Network request failed.", true);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new("Request timed out.", true);
        }
    }

    private static string EscapeSlack(string value) => value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private static async ValueTask<Stream> ConnectPublicAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
        if (addresses.Length == 0 || addresses.Any(address => !IsPublic(address)))
        {
            throw new BlockedAddressException();
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    private static bool IsPublic(IPAddress address)
    {
        var bytes = (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).GetAddressBytes();
        if (bytes.Length == 4)
        {
            return bytes[0] is > 0 and < 224 and not (10 or 127)
                && !(bytes[0] == 100 && bytes[1] is >= 64 and <= 127)
                && !(bytes[0] == 169 && bytes[1] == 254)
                && !(bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                && !(bytes[0] == 192 && (bytes[1] == 168 || bytes[1] == 0 && bytes[2] is 0 or 2 || bytes[1] == 88 && bytes[2] == 99))
                && !(bytes[0] == 198 && (bytes[1] is 18 or 19 || bytes[1] == 51 && bytes[2] == 100))
                && !(bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
                && !(bytes[0] == 168 && bytes[1] == 63 && bytes[2] == 129 && bytes[3] == 16);
        }

        return (bytes[0] & 0xe0) == 0x20
            && !(bytes[0] == 0x20 && (bytes[1] == 2 || bytes[1] == 1 && (bytes[2] < 2 || bytes[2] == 0x0d && bytes[3] == 0xb8)))
            && !(bytes[0] == 0x3f && bytes[1] == 0xff && bytes[2] < 0x10);
    }

    private sealed class BlockedAddressException : IOException;
    private sealed record Outcome(string? Error, bool Transient = false, DateTime? RetryAfter = null);

    private sealed class Delivery
    {
        public long Id { get; init; }
        public long AlertId { get; init; }
        public string AlertTitle { get; init; } = "";
        public string Kind { get; init; } = "";
        public DateTime WindowStart { get; init; }
        public DateTime CreatedAt { get; init; }
        public long EventCount { get; init; }
        public bool IsTest { get; init; }
        public int Attempts { get; init; }
        public string ProtectedUrl { get; init; } = "";
        public string? ProtectedSecret { get; init; }
    }
}
