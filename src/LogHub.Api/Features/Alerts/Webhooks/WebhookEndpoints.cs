using Dapper;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Alerts.Webhooks;

public sealed class WebhookOptions
{
    public string[] AllowedGenericHosts { get; set; } = [];
    public string[] AllowedTeamsHosts { get; set; } = [];
    public string? PublicUrl { get; set; }

    public bool TryDestination(string kind, string? value, out Uri uri)
    {
        uri = null!;
        if (value is not { Length: > 0 and <= 4096 }
            || !Uri.TryCreate(value, UriKind.Absolute, out var parsed)
            || parsed.Scheme != Uri.UriSchemeHttps || parsed.Port != 443
            || parsed.HostNameType != UriHostNameType.Dns || parsed.UserInfo.Length != 0 || parsed.Fragment.Length != 0)
        {
            return false;
        }

        var host = parsed.IdnHost.ToLowerInvariant();
        var allowed = kind switch
        {
            "slack" => host is "hooks.slack.com" or "hooks.slack-gov.com" && parsed.AbsolutePath.StartsWith("/services/", StringComparison.Ordinal),
            "teams" => host.EndsWith(".logic.azure.com", StringComparison.Ordinal)
                || host.EndsWith(".environment.api.powerplatform.com", StringComparison.Ordinal)
                || AllowedTeamsHosts.Contains(host, StringComparer.OrdinalIgnoreCase),
            "generic" => AllowedGenericHosts.Contains(host, StringComparer.OrdinalIgnoreCase),
            _ => false,
        };
        uri = parsed;
        return allowed;
    }
}

public sealed record WebhookInput(string? Name, string? Kind, string? Url, string? SigningSecret, bool Enabled = true);
public sealed record WebhookDestination(long Id, string Name, string Kind, bool Enabled);

public sealed class WebhookEndpoints(NpgsqlDataSource dataSource, IDataProtectionProvider protection, IOptions<WebhookOptions> options)
{
    internal const string ProtectionPurpose = "LogHub.Webhook";
    private const string Columns = "id, name, kind, enabled";

    public static void Map(RouteGroupBuilder api)
    {
        var settings = api.MapGroup("/settings/webhooks").RequireAuthorization(Policies.System);
        settings.MapGet("/", (WebhookEndpoints endpoints, CancellationToken ct) => endpoints.List(ct));
        settings.MapPost("/", (WebhookInput input, WebhookEndpoints endpoints, CancellationToken ct) => endpoints.Save(null, input, ct));
        settings.MapPut("/{id:long}", (long id, WebhookInput input, WebhookEndpoints endpoints, CancellationToken ct) => endpoints.Save(id, input, ct));
        settings.MapDelete("/{id:long}", (long id, WebhookEndpoints endpoints, CancellationToken ct) => endpoints.Delete(id, ct));
        api.MapGet("/alerts/webhook-destinations", (WebhookEndpoints endpoints, CancellationToken ct) => endpoints.List(ct))
            .RequireAuthorization(Policies.Project);
        api.MapPost("/alerts/{id:long}/webhooks/{destinationId:long}/test", Test)
            .RequireAuthorization(Policies.Project).RequireRateLimiting(AlertsFeature.TestEmailRateLimit);
    }

    private async Task<IResult> List(CancellationToken ct)
    {
        await using var db = await dataSource.OpenConnectionAsync(ct);
        return Results.Ok(await db.QueryAsync<WebhookDestination>(new CommandDefinition(
            $"select {Columns} from webhook_destination where not deleted order by name, id", cancellationToken: ct)));
    }

    private async Task<IResult> Save(long? id, WebhookInput input, CancellationToken ct)
    {
        var name = input.Name?.Trim();
        var kind = input.Kind;
        if (name is not { Length: > 0 and <= 100 } || kind is not ("teams" or "slack" or "generic"))
        {
            return Bad("A name and a valid webhook type are required.");
        }

        var protector = protection.CreateProtector(ProtectionPurpose);
        string? url = null;
        if (input.Url is not null)
        {
            if (!options.Value.TryDestination(kind, input.Url, out var uri))
            {
                return Bad("The webhook URL is invalid or its host is not allowed.");
            }
            url = protector.Protect(uri.AbsoluteUri);
        }

        if (input.SigningSecret is not null && (kind != "generic" || input.SigningSecret.Length is < 32 or > 512))
        {
            return Bad("A generic webhook signing secret must have 32 to 512 characters.");
        }

        var secret = input.SigningSecret is null ? null : protector.Protect(input.SigningSecret);
        await using var db = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await db.BeginTransactionAsync(ct);
        if (id.HasValue)
        {
            var existing = await db.QuerySingleOrDefaultAsync<string>(new CommandDefinition(
                "select kind from webhook_destination where id = @id and not deleted for update", new { id }, transaction, cancellationToken: ct));
            if (existing is null)
            {
                return Results.NotFound();
            }

            if (existing != kind && (url is null || kind == "generic" && secret is null))
            {
                return Bad("Provide a URL and any required signing secret when changing webhook type.");
            }
        }
        else if (url is null || kind == "generic" && secret is null)
        {
            return Bad("A URL and any required signing secret are required.");
        }

        var sql = id.HasValue
            ? """
              update webhook_destination set name = @name, kind = @kind, enabled = @enabled,
                  protected_url = coalesce(@url, protected_url),
                  protected_secret = case when @kind = 'generic' then coalesce(@secret, protected_secret) else null end
              where id = @id
              """
            : """
              insert into webhook_destination (name, kind, enabled, protected_url, protected_secret)
              values (@name, @kind, @enabled, @url, @secret)
              """;
        var destination = await db.QuerySingleAsync<WebhookDestination>(new CommandDefinition(
            $"{sql} returning {Columns}", new { id, name, kind, input.Enabled, url, secret }, transaction, cancellationToken: ct));
        if (id.HasValue)
        {
            await CancelPending(db, transaction, id.Value, ct);
        }
        await transaction.CommitAsync(ct);
        return id.HasValue ? Results.Ok(destination) : Results.Created($"/api/v1/settings/webhooks/{destination.Id}", destination);
    }

    private async Task<IResult> Delete(long id, CancellationToken ct)
    {
        await using var db = await dataSource.OpenConnectionAsync(ct);
        await using var transaction = await db.BeginTransactionAsync(ct);
        var affected = await db.ExecuteAsync(new CommandDefinition(
            """
            update webhook_destination set deleted = true, enabled = false, protected_url = '', protected_secret = null
            where id = @id and not deleted
            """, new { id }, transaction, cancellationToken: ct));
        if (affected == 0)
        {
            return Results.NotFound();
        }

        await CancelPending(db, transaction, id, ct);
        await transaction.CommitAsync(ct);
        return Results.NoContent();
    }

    private static Task CancelPending(NpgsqlConnection db, NpgsqlTransaction transaction, long id, CancellationToken ct) =>
        db.ExecuteAsync(new CommandDefinition(
            """
            update webhook_delivery set status = 'Cancelled', error = 'Destination configuration changed', lease_id = null
            where destination_id = @id and status = 'Pending'
            """, new { id }, transaction, cancellationToken: ct));

    private static async Task<IResult> Test(long id, long destinationId, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        await using var db = await dataSource.OpenConnectionAsync(ct);
        var deliveryId = await WebhookDelivery.Enqueue(db, id, destinationId, 0, DateTime.UtcNow, ct);
        return deliveryId is null ? Results.NotFound() : Results.Accepted(value: new { deliveryId });
    }

    private static IResult Bad(string message) => ApiErrors.Result(StatusCodes.Status400BadRequest, message);
}
