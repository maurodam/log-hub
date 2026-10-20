using System.Data.Common;
using Dapper;
using LogHub.Api.Features.Alerts.Email;
using LogHub.Api.Features.Events;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Alerts;

/// <summary>Configuration section "Alerts".</summary>
public sealed class AlertOptions
{
    /// <summary>Seconds between two checks of the enabled alerts.</summary>
    public int IntervalSeconds { get; set; } = 60;

    /// <summary>
    /// Email domains alerts may be sent to (for example "contoso.com"). Empty: any domain.
    /// Stops alerts from being used to send log data or spam to outside addresses through your SMTP server.
    /// </summary>
    public string[] AllowedRecipientDomains { get; set; } = [];

    public bool IsAllowedRecipient(string email) =>
        AllowedRecipientDomains.Length == 0
        || AllowedRecipientDomains.Any(domain => email.EndsWith("@" + domain.Trim().TrimStart('@'), StringComparison.OrdinalIgnoreCase));
}

/// <summary>Outcome of one alert email. IsConfigured is false when SMTP is not set up.</summary>
public sealed record AlertNotification(bool Sent, bool IsConfigured, long EventCount, string? Error);

/// <summary>
/// Checks the enabled alerts every Alerts:IntervalSeconds: counts the events matching signal and filter in the last
/// WindowMinutes; at Threshold or more, unless the last successful email is newer than SuppressionMinutes, emails the
/// recipients (up to 10 sample events and a link) and records a notification (Sent or Failed).
/// A PostgreSQL advisory lock lets only one replica check at a time.
/// </summary>
public sealed class AlertService(
    NpgsqlDataSource dataSource,
    SmtpSettingsStore smtpSettings,
    IEmailSender emailSender,
    IOptions<AlertOptions> options,
    ILogger<AlertService> logger) : BackgroundService
{
    public const string NotConfigured = "SMTP is not configured";
    public const string StatusSent = "Sent";
    public const string StatusFailed = "Failed";

    private const long LockKey = 0x4C6F67487562416C; // "LogHubAl"
    private const int SampleSize = 10;
    private const int MaxErrorLength = 2000;

    private readonly SemaphoreSlim running = new(1, 1);

    /// <summary>Checks every enabled alert now. Returns the number of emails sent, or null when another replica holds the lock.</summary>
    public async Task<int?> RunOnceAsync(CancellationToken cancellationToken)
    {
        await running.WaitAsync(cancellationToken);
        try
        {
            await using var lockConnection = await dataSource.OpenConnectionAsync(cancellationToken);
            var acquired = await lockConnection.ExecuteScalarAsync<bool>(new CommandDefinition(
                "select pg_try_advisory_lock(@key)", new { key = LockKey }, cancellationToken: cancellationToken));
            if (!acquired)
            {
                logger.LogDebug("Alert check skipped: another instance is running it");
                return null;
            }

            try
            {
                return await CheckAllAsync(cancellationToken);
            }
            finally
            {
                await lockConnection.ExecuteScalarAsync<bool>(new CommandDefinition(
                    "select pg_advisory_unlock(@key)", new { key = LockKey }, cancellationToken: CancellationToken.None));
            }
        }
        finally
        {
            running.Release();
        }
    }

    /// <summary>Emails the events currently matching the alert, whatever the threshold and suppression; records the notification.</summary>
    public async Task<AlertNotification> SendTestAsync(AlertRow alert, long? userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var filter = await BuildFilterAsync(connection, alert, now, cancellationToken);
        var count = await CountAsync(connection, filter, cancellationToken);
        return await NotifyAsync(connection, alert, filter, count, now, userId, isTest: true, cancellationToken);
    }

    public override void Dispose()
    {
        running.Dispose();
        base.Dispose();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, options.Value.IntervalSeconds)));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogError(ex, "Alert check failed");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown.
        }
    }

    private async Task<int> CheckAllAsync(CancellationToken cancellationToken)
    {
        List<AlertRow> alerts;
        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        {
            alerts = (await connection.QueryAsync<AlertRow>(new CommandDefinition(
                $"""select {AlertRow.Columns} from alert where is_enabled order by id """,
                cancellationToken: cancellationToken))).AsList();
        }

        var sent = 0;
        foreach (var alert in alerts)
        {
            try
            {
                if (await CheckAsync(alert, cancellationToken))
                {
                    sent++;
                }
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogError(ex, "Checking alert {AlertId} failed", alert.Id);
                await SetLastErrorAsync(alert.Id, ex.Message, cancellationToken);
            }
        }

        return sent;
    }

    /// <summary>Returns true when an email was sent.</summary>
    private async Task<bool> CheckAsync(AlertRow alert, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var filter = await BuildFilterAsync(connection, alert, now, cancellationToken);
        var count = await CountAsync(connection, filter, cancellationToken);

        await connection.ExecuteAsync(new CommandDefinition(
            """update alert set last_checked_date = @now where id = @id""", new { id = alert.Id, now }, cancellationToken: cancellationToken));

        if (count < alert.Threshold
            || alert.LastTriggeredDate is { } last && last > now.AddMinutes(-alert.SuppressionMinutes))
        {
            return false;
        }

        var notification = await NotifyAsync(connection, alert, filter, count, now, userId: null, isTest: false, cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            notification.Sent
                ? """update alert set last_triggered_date = @now, last_error = null where id = @id"""
                : """update alert set last_error = @error where id = @id""",
            new { id = alert.Id, now, error = Truncate(notification.Error) },
            cancellationToken: cancellationToken));

        if (notification.Sent)
        {
            logger.LogInformation("Alert {AlertId} ({AlertTitle}) sent: {EventCount} events in {WindowMinutes} min", alert.Id, alert.Title, count, alert.WindowMinutes);
        }
        else
        {
            logger.LogWarning("Alert {AlertId} ({AlertTitle}) not sent: {Error}", alert.Id, alert.Title, notification.Error);
        }

        return notification.Sent;
    }

    private async Task<AlertNotification> NotifyAsync(
        NpgsqlConnection connection,
        AlertRow alert,
        EventFilter filter,
        long count,
        DateTime now,
        long? userId,
        bool isTest,
        CancellationToken cancellationToken)
    {
        AlertNotification notification;
        SmtpConfiguration? smtp = null;
        string? configurationError = null;
        try
        {
            smtp = await smtpSettings.GetConfigurationAsync(cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            configurationError = ex.Message;
        }

        if (smtp is null)
        {
            notification = new AlertNotification(false, configurationError is not null, count, configurationError ?? NotConfigured);
        }
        else
        {
            var events = (await connection.QueryAsync<EventRow>(new CommandDefinition(
                $"""{EventRow.SelectColumns}{filter.WhereClause()} order by timestamp desc, id desc limit {SampleSize}""",
                filter.Parameters,
                cancellationToken: cancellationToken))).AsList();

            var message = AlertEmail.Compose(alert, count, events, smtp.PublicUrl, WindowStart(alert, now), isTest);
            try
            {
                await emailSender.SendAsync(smtp, message, cancellationToken);
                notification = new AlertNotification(true, true, count, null);
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(ex, "Email for alert {AlertId} to {Host}:{Port} failed", alert.Id, smtp.Host, smtp.Port);
                notification = new AlertNotification(false, true, count, ex.Message);
            }
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into notification (alert_id, triggered_date, event_count, recipients, status, error, user_created_id)
            values (@alertId, @now, @count, @recipients, @status, @error, @userId)
            """,
            new
            {
                alertId = alert.Id,
                now,
                count,
                recipients = alert.Recipients,
                status = notification.Sent ? StatusSent : StatusFailed,
                error = Truncate(notification.Error),
                userId,
            },
            cancellationToken: cancellationToken));

        return notification;
    }

    private async Task SetLastErrorAsync(long id, string error, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await connection.ExecuteAsync(new CommandDefinition(
                """update alert set last_error = @error where id = @id""", new { id, error = Truncate(error) }, cancellationToken: cancellationToken));
        }
        catch (NpgsqlException ex)
        {
            logger.LogWarning(ex, "Saving the error of alert {AlertId} failed", id);
        }
    }

    private static DateTime WindowStart(AlertRow alert, DateTime now) => now.AddMinutes(-alert.WindowMinutes);

    /// <summary>Alert filter AND signal (the check acts for the system: any signal counts, whatever its owner) in the window.</summary>
    private static async Task<EventFilter> BuildFilterAsync(DbConnection connection, AlertRow alert, DateTime now, CancellationToken cancellationToken)
    {
        var filter = new EventFilter().AddSpec(alert.ParseFilter()).AddTimeRange(WindowStart(alert, now), null);
        if (alert.SignalId is { } signalId)
        {
            var signals = await connection.QueryAsync<(long Id, string? GroupName, string Filter)>(new CommandDefinition(
                """select id, group_name, filter::text from signal where id = @signalId""", new { signalId }, cancellationToken: cancellationToken));
            filter.AddSignals(signals.Select(s => new SignalDefinition(s.Id, s.GroupName, FilterSpec.FromJson(s.Filter))));
        }

        return filter;
    }

    private static Task<long> CountAsync(DbConnection connection, EventFilter filter, CancellationToken cancellationToken) =>
        connection.ExecuteScalarAsync<long>(new CommandDefinition(
            $"""select count(*) from event{filter.WhereClause()}""", filter.Parameters, cancellationToken: cancellationToken));

    private static string? Truncate(string? error) => error is { Length: > MaxErrorLength } ? error[..MaxErrorLength] : error;
}
