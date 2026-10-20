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
    bool IsEnabled = true);

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
    string? LastError);

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
}

/// <summary>Row read by Dapper from the alert table.</summary>
public sealed class AlertRow
{
    public const string Columns = """
        id, title, description, signal_id, filter::text as filter, threshold, window_minutes, suppression_minutes,
        recipients, is_enabled, last_checked_date, last_triggered_date, last_error
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

    public DateTime? LastCheckedDate { get; init; }

    public DateTime? LastTriggeredDate { get; init; }

    public string? LastError { get; init; }

    public FilterSpec ParseFilter() => FilterSpec.FromJson(Filter);

    public AlertDto ToDto() => new(
        Id, Title, Description, SignalId, ParseFilter(), Threshold, WindowMinutes, SuppressionMinutes, Recipients, IsEnabled,
        LastCheckedDate, LastTriggeredDate, LastError);
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
        var (alert, error) = await ValidateAsync(input, user, filters, options.Value, cancellationToken);
        if (alert is null)
        {
            return error!;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleAsync<AlertRow>(new CommandDefinition(
            $"""
            insert into alert (title, description, signal_id, filter, threshold, window_minutes, suppression_minutes,
                               recipients, is_enabled, user_created_id)
            values (@Title, @Description, @SignalId, @Filter::jsonb, @Threshold, @WindowMinutes, @SuppressionMinutes,
                    @Recipients, @IsEnabled, @UserId)
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
        var (alert, error) = await ValidateAsync(input, user, filters, options.Value, cancellationToken);
        if (alert is null)
        {
            return error!;
        }

        var parameters = Parameters(alert, user);
        parameters.Add("Id", id);

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<AlertRow>(new CommandDefinition(
            $"""
            update alert
            set title = @Title, description = @Description, signal_id = @SignalId, filter = @Filter::jsonb,
                threshold = @Threshold, window_minutes = @WindowMinutes, suppression_minutes = @SuppressionMinutes,
                recipients = @Recipients, is_enabled = @IsEnabled, user_updated_id = @UserId, user_updated_date = now()
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
            select id, alert_id, triggered_date, event_count, recipients, status, error
            from notification
            where alert_id = @id
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
        if (recipients.Length is < 1 or > MaxRecipients)
        {
            return Invalid($"recipients must contain between 1 and {MaxRecipients} email addresses.");
        }

        if (recipients.FirstOrDefault(recipient => !EmailAddress.IsValid(recipient)) is { } invalid)
        {
            return Invalid($"'{invalid}' is not a valid email address.");
        }

        if (recipients.FirstOrDefault(recipient => !options.IsAllowedRecipient(recipient)) is { } outside)
        {
            return Invalid($"'{outside}' is outside the allowed domains ({string.Join(", ", options.AllowedRecipientDomains)}).");
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

        return (input with { Title = title, Description = description, Filter = filter, Recipients = recipients }, null);
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
        parameters.Add("IsEnabled", alert.IsEnabled);
        parameters.Add("UserId", user.GetUserId());
        return parameters;
    }
}
