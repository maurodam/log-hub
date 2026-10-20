using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Features.Retention;

/// <summary>Applies Retention:DefaultDays at startup: creates or updates the enabled all-events policy.</summary>
public static class RetentionDefaults
{
    public static async Task ApplyAsync(IServiceProvider services, CancellationToken cancellationToken = default)
    {
        var options = services.GetRequiredService<IOptions<RetentionOptions>>().Value;
        if (options.DefaultDays is null or 0)
        {
            return;
        }

        if (options.DefaultDays is < 1 or > RetentionPolicies.MaxRetentionDays)
        {
            throw new InvalidOperationException($"Retention:DefaultDays must be between 1 and {RetentionPolicies.MaxRetentionDays} (or empty).");
        }

        await ApplyAsync(services.GetRequiredService<NpgsqlDataSource>(), options.DefaultDays.Value, cancellationToken);
        services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(RetentionDefaults))
            .LogInformation("Retention: events older than {RetentionDays} days are deleted (Retention:DefaultDays)", options.DefaultDays);
    }

    public static async Task ApplyAsync(NpgsqlDataSource dataSource, int retentionDays, CancellationToken cancellationToken = default)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into retention (signal_id, retention_days, is_enabled)
            values (null, @retentionDays, true)
            on conflict (signal_id) do update
            set retention_days = excluded.retention_days, is_enabled = true, user_updated_id = null, user_updated_date = now()
            where retention.retention_days <> excluded.retention_days or not retention.is_enabled
            """,
            new { retentionDays },
            cancellationToken: cancellationToken));
    }
}
