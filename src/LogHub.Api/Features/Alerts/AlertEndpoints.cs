using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts.Email;
using LogHub.Api.Features.Events;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Alerts;

/// <summary>Body of POST and PUT /api/v1/alerts.</summary>
public sealed record AlertInput(
    string? Title,
    string? Description,
    long? SignalId,
    FilterSpec? Filter,
    int Threshold = 1,
    int WindowMinutes = 5,
    int SuppressionMinutes = 60,
    string[]? Recipients = null,
    bool IsEnabled = true,
    long[]? WebhookDestinationIds = null);

public sealed record AlertDto(
    long Id,
    string Title,
    string? Description,
    long? SignalId,
    FilterSpec Filter,
    int Threshold,
    int WindowMinutes,
    int SuppressionMinutes,
    string[] Recipients,
    bool IsEnabled,
    DateTime? LastCheckedDate,
    DateTime? LastTriggeredDate,
    string? LastError,
    long[] WebhookDestinationIds);

/// <summary>Alert email history. Init properties (not positional): Dapper reads text[] columns only into properties.</summary>
public sealed record NotificationDto
{
    public long Id { get; init; }

    public long AlertId { get; init; }

    public DateTime TriggeredDate { get; init; }

    public long EventCount { get; init; }

    public string[] Recipients { get; init; } = [];

    public string Status { get; init; } = string.Empty;

    public string? Error { get; init; }

    public string? DestinationName { get; init; }

    public string? Kind { get; init; }

    public long? DeliveryId { get; init; }

    public int? Attempts { get; init; }

    public bool IsTest { get; init; }
}

/// <summary>Row read by Dapper from the alert table.</summary>
public sealed class AlertRow
{
    public const string Columns = """
        id, title, description, signal_id, filter::text as filter, threshold, window_minutes, suppression_minutes,
        recipients, is_enabled, last_checked_date, last_triggered_date, last_error, webhook_destination_ids
        """;

    public long Id { get; init; }

    public string Title { get; init; } = string.Empty;

    public string? Description { get; init; }

    public long? SignalId { get; init; }

    public string Filter { get; init; } = "{}";

    public int Threshold { get; init; }

    public int WindowMinutes { get; init; }

    public int SuppressionMinutes { get; init; }

    public string[] Recipients { get; init; } = [];

    public bool IsEnabled { get; init; }

    public long[] WebhookDestinationIds { get; init; } = [];

    public DateTime? LastCheckedDate { get; init; }

    public DateTime? LastTriggeredDate { get; init; }

    public string? LastError { get; init; }

    public FilterSpec ParseFilter() => FilterSpec.FromJson(Filter);

    public AlertDto ToDto() => new(
        Id, Title, Description, SignalId, ParseFilter(), Threshold, WindowMinutes, SuppressionMinutes, Recipients, IsEnabled,
        LastCheckedDate, LastTriggeredDate, LastError, WebhookDestinationIds);
}

/// <summary>/api/v1/alerts: CRUD (Project), list and history (Read), test email (Project).</summary>
public static class AlertEndpoints
{
    public const int MaxWindowMinutes = 1440;
    public const int MaxSuppressionMinutes = 10080;
    public const int MaxRecipients = 20;
    private const int NotificationLimit = 50;

    public static async Task<IResult> List(NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<AlertRow>(new CommandDefinition(
            $"""select {AlertRow.Columns} from alert order by title, id """, cancellationToken: cancellationToken));
        return Results.Ok(rows.Select(row => row.ToDto()));
    }

    public static async Task<IResult> Create(
        AlertInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        IOptions<AlertOptions> options,
        CancellationToken cancellationToken)
    {
        var (alert, error) = await ValidateAsync(input, user, filters, options.Value, dataSource, cancellationToken);
        if (alert is null)
        {
            return error!;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleAsync<AlertRow>(new CommandDefinition(
            $"""
            insert into alert (title, description, signal_id, filter, threshold, window_minutes, suppression_minutes,
                               recipients, is_enabled, user_created_id, webhook_destination_ids)
            values (@Title, @Description, @SignalId, @Filter::jsonb, @Threshold, @WindowMinutes, @SuppressionMinutes,
                    @Recipients, @IsEnabled, @UserId, @WebhookDestinationIds)
            returning {AlertRow.Columns}
            """,
            Parameters(alert, user),
            cancellationToken: cancellationToken));

        return Results.Created($"/api/v1/alerts/{row.Id}", row.ToDto());
    }

    public static async Task<IResult> Update(
        long id,
        AlertInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        IOptions<AlertOptions> options,
        CancellationToken cancellationToken)
    {
        var existing = await FindAsync(id, dataSource, cancellationToken);
        if (existing is null)
        {
            return Results.NotFound();
        }

        var preserveDestinations = input.WebhookDestinationIds is null;
        input = input with { WebhookDestinationIds = input.WebhookDestinationIds ?? existing.WebhookDestinationIds };
        var (alert, error) = await ValidateAsync(input, user, filters, options.Value, dataSource, cancellationToken);
        if (alert is null)
        {
            return error!;
        }

        var parameters = Parameters(alert, user);
        parameters.Add("Id", id);
        parameters.Add("PreserveDestinations", preserveDestinations);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<AlertRow>(new CommandDefinition(
            $"""
            update alert
            set title = @Title, description = @Description, signal_id = @SignalId, filter = @Filter::jsonb,
                threshold = @Threshold, window_minutes = @WindowMinutes, suppression_minutes = @SuppressionMinutes,
                recipients = @Recipients, is_enabled = @IsEnabled, user_updated_id = @UserId, user_updated_date = now(),
                webhook_destination_ids = case when @PreserveDestinations then webhook_destination_ids else @WebhookDestinationIds end
            where id = @Id
            returning {AlertRow.Columns}
            """,
            parameters,
            cancellationToken: cancellationToken));

        return row is null ? Results.NotFound() : Results.Ok(row.ToDto());
    }

    public static async Task<IResult> Delete(long id, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var deleted = await connection.ExecuteAsync(new CommandDefinition(
            """delete from alert where id = @id""", new { id }, cancellationToken: cancellationToken));
        return deleted == 0 ? Results.NotFound() : Results.NoContent();
    }

    /// <summary>POST /api/v1/alerts/{id}/test: emails the current matching events now; recorded as a notification.</summary>
    public static async Task<IResult> Test(
        long id,
        ClaimsPrincipal user,
        AlertService alerts,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        var alert = await FindAsync(id, dataSource, cancellationToken);
        if (alert is null)
        {
            return Results.NotFound();
        }

        if (alert.Recipients.Length == 0)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "This alert has no email recipients.");
        }

        AlertNotification notification;
        try
        {
            notification = await alerts.SendTestAsync(alert, user.GetUserId(), cancellationToken);
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }

        return notification switch
        {
            { Sent: true } => Results.NoContent(),
            { IsConfigured: false } => ApiErrors.Result(StatusCodes.Status400BadRequest, notification.Error ?? AlertService.NotConfigured),
            _ => ApiErrors.Result(StatusCodes.Status502BadGateway, notification.Error ?? "Sending failed."),
        };
    }

    /// <summary>GET /api/v1/alerts/{id}/notifications: the last 50, newest first.</summary>
    public static async Task<IResult> Notifications(long id, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var exists = await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """select exists (select 1 from alert where id = @id)""", new { id }, cancellationToken: cancellationToken));
        if (!exists)
        {
            return Results.NotFound();
        }

        var notifications = await connection.QueryAsync<NotificationDto>(new CommandDefinition(
            """
            select id, alert_id, triggered_date, event_count, recipients, status, error,
                null::varchar as destination_name, null::varchar as kind, null::bigint as delivery_id, null::int as attempts, false as is_test
            from notification where alert_id = @id
            union all
            select -id, alert_id, created_at, event_count, array[]::text[], status, error,
                destination_name, kind, id, attempts, is_test
            from webhook_delivery where alert_id = @id
            order by triggered_date desc, id desc
            limit @limit
            """,
            new { id, limit = NotificationLimit },
            cancellationToken: cancellationToken));

        return Results.Ok(notifications);
    }

    public static async Task<AlertRow?> FindAsync(long id, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<AlertRow>(new CommandDefinition(
            $"""select {AlertRow.Columns} from alert where id = @id""", new { id }, cancellationToken: cancellationToken));
    }

    /// <summary>Validates and normalizes the input (trimmed texts, distinct recipients, non-null filter).</summary>
    private static async Task<(AlertInput? Alert, IResult? Error)> ValidateAsync(
        AlertInput input,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        AlertOptions options,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        static (AlertInput?, IResult?) Invalid(string message) => (null, ApiErrors.Result(StatusCodes.Status400BadRequest, message));

        var title = input.Title?.Trim();
        if (string.IsNullOrEmpty(title) || title.Length > 200)
        {
            return Invalid("title is required (at most 200 characters).");
        }

        var description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        if (description?.Length > 1000)
        {
            return Invalid("description must be at most 1000 characters.");
        }

        if (input.Threshold < 1)
        {
            return Invalid("threshold must be at least 1.");
        }

        if (input.WindowMinutes is < 1 or > MaxWindowMinutes)
        {
            return Invalid($"windowMinutes must be between 1 and {MaxWindowMinutes}.");
        }

        if (input.SuppressionMinutes is < 0 or > MaxSuppressionMinutes)
        {
            return Invalid($"suppressionMinutes must be between 0 and {MaxSuppressionMinutes}.");
        }

        var recipients = (input.Recipients ?? [])
            .Select(recipient => recipient?.Trim() ?? string.Empty)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var destinations = (input.WebhookDestinationIds ?? []).Distinct().ToArray();
        if (recipients.Length == 0 && destinations.Length == 0 || recipients.Length > MaxRecipients)
        {
            return Invalid($"Provide an email recipient or a webhook destination. At most {MaxRecipients} email recipients are allowed.");
        }

        if (recipients.FirstOrDefault(recipient => !EmailAddress.IsValid(recipient)) is { } invalid)
        {
            return Invalid($"'{invalid}' is not a valid email address.");
        }

        if (recipients.FirstOrDefault(recipient => !options.IsAllowedRecipient(recipient)) is { } outside)
        {
            return Invalid($"'{outside}' is outside the allowed domains ({string.Join(", ", options.AllowedRecipientDomains)}).");
        }

        if (destinations.Length > 20)
        {
            return Invalid("At most 20 webhook destinations are allowed.");
        }

        if (destinations.Length > 0)
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            var matches = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                "select count(*)::int from webhook_destination where id = any(@destinations)",
                new { destinations }, cancellationToken: cancellationToken));
            if (matches != destinations.Length)
            {
                return Invalid("A webhook destination does not exist.");
            }
        }

        var filter = input.Filter ?? new FilterSpec();
        try
        {
            new EventFilter().AddSpec(filter);
        }
        catch (FilterException ex)
        {
            return Invalid(ex.Message);
        }

        if (input.SignalId is { } signalId
            && (await filters.GetVisibleSignalsAsync([signalId], user.GetUserId(), cancellationToken)).Count == 0)
        {
            return Invalid("The signal does not exist.");
        }

        return (input with { Title = title, Description = description, Filter = filter, Recipients = recipients, WebhookDestinationIds = destinations }, null);
    }

    private static DynamicParameters Parameters(AlertInput alert, ClaimsPrincipal user)
    {
        var parameters = new DynamicParameters();
        parameters.Add("Title", alert.Title);
        parameters.Add("Description", alert.Description);
        parameters.Add("SignalId", alert.SignalId);
        parameters.Add("Filter", (alert.Filter ?? new FilterSpec()).ToJson());
        parameters.Add("Threshold", alert.Threshold);
        parameters.Add("WindowMinutes", alert.WindowMinutes);
        parameters.Add("SuppressionMinutes", alert.SuppressionMinutes);
        parameters.Add("Recipients", alert.Recipients ?? []);
        parameters.Add("WebhookDestinationIds", alert.WebhookDestinationIds ?? []);
        parameters.Add("IsEnabled", alert.IsEnabled);
        parameters.Add("UserId", user.GetUserId());
        return parameters;
    }
}
