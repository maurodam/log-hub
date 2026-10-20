using System.Globalization;
using System.Net;
using System.Text;
using LogHub.Api.Features.Alerts.Email;
using LogHub.Api.Features.Events;
using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Features.Alerts;

/// <summary>Alert email: subject with the count, sample events (UTC), link to the matching events when publicUrl is set.</summary>
public static class AlertEmail
{
    private const int MaxMessageLength = 300;

    public static EmailMessage Compose(AlertRow alert, long count, IReadOnlyList<EventRow> events, string? publicUrl, DateTime windowStart, bool isTest)
    {
        var subject = string.Create(
            CultureInfo.InvariantCulture,
            $"[LogHub] {(isTest ? "Test: " : "")}{alert.Title}: {count} events in the last {alert.WindowMinutes} min");
        var summary = string.Create(
            CultureInfo.InvariantCulture,
            $"{count} events matched \"{alert.Title}\" in the last {alert.WindowMinutes} minutes (threshold {alert.Threshold}).");
        var link = string.IsNullOrEmpty(publicUrl) ? null : $"{publicUrl}/events?{EventsQuery(alert, windowStart)}";

        var text = new StringBuilder();
        var html = new StringBuilder("""<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">""");
        if (isTest)
        {
            text.AppendLine("Test email sent from LogHub.").AppendLine();
            html.Append("<p><em>Test email sent from LogHub.</em></p>");
        }

        text.AppendLine(summary);
        html.Append("<p><strong>").Append(Encode(summary)).Append("</strong></p>");
        if (!string.IsNullOrEmpty(alert.Description))
        {
            text.AppendLine(alert.Description);
            html.Append("<p>").Append(Encode(alert.Description)).Append("</p>");
        }

        if (events.Count > 0)
        {
            text.AppendLine().AppendLine(events.Count == count ? "Events:" : $"Latest {events.Count} events:");
            html.Append("""<table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">Time (UTC)</th><th align="left">Level</th><th align="left">Message</th></tr>""");
            foreach (var e in events)
            {
                var time = e.Timestamp.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
                var level = LogLevels.Name(e.LevelRank);
                var message = Shorten(e.Message ?? e.MessageTemplate ?? string.Empty);
                text.Append(time).Append("  ").Append(level.PadRight(11)).Append(' ').AppendLine(message);
                html.Append("<tr><td style=\"white-space:nowrap\">").Append(time)
                    .Append("</td><td>").Append(level)
                    .Append("</td><td>").Append(Encode(message)).Append("</td></tr>");
            }

            html.Append("</table>");
        }

        if (link is not null)
        {
            text.AppendLine().Append("View the events: ").AppendLine(link);
            html.Append("<p><a href=\"").Append(Encode(link)).Append("\">View the events in LogHub</a></p>");
        }

        html.Append("</div>");
        return new EmailMessage(alert.Recipients, subject, text.ToString(), html.ToString());
    }

    /// <summary>Query string of the events page (see docs/api/v1.md, Events): alert filter, signal and window start.</summary>
    public static string EventsQuery(AlertRow alert, DateTime windowStart)
    {
        var spec = alert.ParseFilter();
        var parts = new List<string>();

        Add("text", spec.Text);
        Add("levels", spec.Levels is { Length: > 0 } levels ? string.Join(',', levels) : null);
        foreach (var property in spec.Properties ?? [])
        {
            Add("property", property);
        }

        Add("apiKeys", spec.ApiKeyIds is { Length: > 0 } ids ? string.Join(',', ids.Select(id => id.ToString(CultureInfo.InvariantCulture))) : null);
        Add("hasException", spec.HasException is { } hasException ? (hasException ? "true" : "false") : null);
        Add("traceId", spec.TraceId);
        Add("eventType", spec.EventType);
        Add("signals", alert.SignalId?.ToString(CultureInfo.InvariantCulture));
        Add("from", windowStart.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
        return string.Join('&', parts);

        void Add(string name, string? value)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                parts.Add($"{name}={Uri.EscapeDataString(value)}");
            }
        }
    }

    private static string Shorten(string message)
    {
        var line = message.ReplaceLineEndings(" ").Trim();
        return line.Length > MaxMessageLength ? line[..MaxMessageLength] + "..." : line;
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
