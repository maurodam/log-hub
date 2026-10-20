using System.Security.Claims;
using Dapper;
using LogHub.Api.Common.Security;
using Npgsql;

namespace LogHub.Api.Features.Events;

/// <summary>Builds an <see cref="EventFilter"/> from the query string, resolving the selected signals.</summary>
public sealed class EventFilterBuilder(NpgsqlDataSource dataSource)
{
    public async Task<EventFilter> BuildAsync(EventQuery query, bool includeTimeRange, ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        var filter = new EventFilter().AddSpec(query.ToSpec());

        if (includeTimeRange)
        {
            filter.AddTimeRange(query.From, query.To);
        }

        var signalIds = query.SignalIds().Distinct().ToArray();
        if (signalIds.Length > 0)
        {
            var signals = await GetVisibleSignalsAsync(signalIds, user.GetUserId(), cancellationToken);
            if (signals.Count != signalIds.Length)
            {
                throw new FilterException("One or more signals do not exist.");
            }

            filter.AddSignals(signals);
        }

        return filter;
    }

    /// <summary>Shared signals plus the account's own (API keys see shared signals only).</summary>
    public async Task<List<SignalDefinition>> GetVisibleSignalsAsync(long[] ids, long? userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = await connection.QueryAsync<(long Id, string? GroupName, string Filter)>(new CommandDefinition(
            """
            select id, group_name, filter::text
            from signal
            where id = any(@ids) and (owner_id is null or owner_id = @userId)
            """,
            new { ids, userId },
            cancellationToken: cancellationToken));

        return rows.Select(row => new SignalDefinition(row.Id, row.GroupName, FilterSpec.FromJson(row.Filter))).ToList();
    }
}
