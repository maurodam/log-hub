using MailKit.Security;
using MimeKit;
using SmtpClient = MailKit.Net.Smtp.SmtpClient;

namespace LogHub.Api.Features.Alerts.Email;

/// <summary>Effective SMTP configuration used to send (password in clear text: never serialize it).</summary>
public sealed record SmtpConfiguration(
    string Host,
    int Port,
    string? Username,
    string? Password,
    string Security,
    string FromAddress,
    string? FromName,
    string? PublicUrl);

public sealed record EmailMessage(IReadOnlyList<string> To, string Subject, string TextBody, string HtmlBody);

/// <summary>Sends emails. Singleton; tests may replace it.</summary>
public interface IEmailSender
{
    Task SendAsync(SmtpConfiguration smtp, EmailMessage message, CancellationToken cancellationToken);
}

/// <summary>SMTP with MailKit: one connection per message, 30 s timeout, login only when a username is set.</summary>
public sealed class MailKitEmailSender : IEmailSender
{
    private const int TimeoutMilliseconds = 30_000;

    public async Task SendAsync(SmtpConfiguration smtp, EmailMessage message, CancellationToken cancellationToken)
    {
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(string.IsNullOrWhiteSpace(smtp.FromName) ? "LogHub" : smtp.FromName, smtp.FromAddress));
        foreach (var to in message.To)
        {
            mime.To.Add(MailboxAddress.Parse(to));
        }

        mime.Subject = message.Subject;
        mime.Body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody }.ToMessageBody();

        using var client = new SmtpClient { Timeout = TimeoutMilliseconds };
        await client.ConnectAsync(smtp.Host, smtp.Port, ToSocketOptions(smtp.Security), cancellationToken);
        if (!string.IsNullOrEmpty(smtp.Username))
        {
            await client.AuthenticateAsync(smtp.Username, smtp.Password ?? string.Empty, cancellationToken);
        }

        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(quit: true, cancellationToken);
    }

    private static SecureSocketOptions ToSocketOptions(string security) => security switch
    {
        SmtpSecurity.None => SecureSocketOptions.None,
        SmtpSecurity.SslOnConnect => SecureSocketOptions.SslOnConnect,
        _ => SecureSocketOptions.StartTls,
    };
}

/// <summary>Values of SmtpSettings.security.</summary>
public static class SmtpSecurity
{
    public const string None = "None";
    public const string StartTls = "StartTls";
    public const string SslOnConnect = "SslOnConnect";

    private static readonly string[] All = [None, StartTls, SslOnConnect];

    /// <summary>The canonical name (case-insensitive match), or null when unknown.</summary>
    public static string? Normalize(string? value) =>
        All.FirstOrDefault(name => string.Equals(name, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static int DefaultPort(string security) => security switch
    {
        None => 25,
        SslOnConnect => 465,
        _ => 587,
    };
}

public static class EmailAddress
{
    /// <summary>A plain address such as "ops@example.com" (no display name).</summary>
    public static bool IsValid(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && System.Net.Mail.MailAddress.TryCreate(value, out var address)
        && string.Equals(address.Address, value, StringComparison.Ordinal)
        && string.IsNullOrEmpty(address.DisplayName);
}
