using System.Buffers.Text;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using Dapper;
using LogHub.Api.Common.Security;
using Npgsql;

namespace LogHub.Api.Features.Events;

public sealed record EventPage(IReadOnlyList<LogEventDto> Events, string? NextCursor);

/// <summary>
/// GET /api/v1/events: newest first, keyset paging on (timestamp, id).
/// The cursor is opaque to clients: base64url of "ticks:id" of the last event returned.
/// </summary>
public static class ListEvents
{
    private const int DefaultCount = 100;
    private const int MaxCount = 1000;

    public static async Task<IResult> Handle(
        [AsParameters] EventQuery query,
        int? count,
        string? cursor,
        ClaimsPrincipal user,
        EventFilterBuilder filters,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        try
        {
            var filter = await filters.BuildAsync(query, includeTimeRange: true, user, cancellationToken);
            return Results.Ok(await QueryAsync(filter, count ?? DefaultCount, cursor, dataSource, cancellationToken));
        }
        catch (FilterException ex)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, ex.Message);
        }
    }

    public static async Task<EventPage> QueryAsync(EventFilter filter, int count, string? cursor, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (cursor is not null)
        {
            if (!TryDecodeCursor(cursor, out var after))
            {
                throw new FilterException("The cursor is not valid.");
            }

            filter.Where($"""(timestamp, id) < ({filter.Parameter(after.Timestamp)}, {filter.Parameter(after.Id)})""");
        }

        var pageSize = Math.Clamp(count, 1, MaxCount);
        var sql = new StringBuilder(EventRow.SelectColumns);
        filter.AppendWhere(sql);
        sql.Append($""" order by timestamp desc, id desc limit {filter.Parameter(pageSize + 1)}""");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<EventRow>(
            new CommandDefinition(sql.ToString(), filter.Parameters, cancellationToken: cancellationToken))).AsList();

        var hasMore = rows.Count > pageSize;
        if (hasMore)
        {
            rows.RemoveAt(rows.Count - 1);
        }

        var nextCursor = hasMore ? EncodeCursor(rows[^1].Timestamp, rows[^1].Id) : null;
        return new EventPage(rows.ConvertAll(row => row.ToDto()), nextCursor);
    }

    private static string EncodeCursor(DateTime timestamp, long id) =>
        Base64Url.EncodeToString(Encoding.UTF8.GetBytes(
            string.Create(CultureInfo.InvariantCulture, $"{timestamp.Ticks}:{id}")));

    private static bool TryDecodeCursor(string cursor, out (DateTime Timestamp, long Id) position)
    {
        position = default;
        try
        {
            var parts = Encoding.UTF8.GetString(Base64Url.DecodeFromChars(cursor)).Split(':');
            if (parts.Length == 2
                && long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                && long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var id)
                && ticks is >= 0 and <= 3155378975999999999)
            {
                position = (new DateTime(ticks, DateTimeKind.Utc), id);
                return true;
            }
        }
        catch (FormatException)
        {
        }

        return false;
    }
}
