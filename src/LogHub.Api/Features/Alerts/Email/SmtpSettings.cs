using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Dapper;
using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.DataProtection;
using Npgsql;

namespace LogHub.Api.Features.Alerts.Email;

/// <summary>Body of PUT /api/v1/settings/smtp. Password null keeps the stored one, "" removes it.</summary>
public sealed record SmtpSettingsInput(
    string? Host,
    int? Port,
    string? Username,
    string? Password,
    string? Security,
    string? FromAddress,
    string? FromName,
    string? PublicUrl);

/// <summary>SMTP settings as shown to administrators: never the password.</summary>
public sealed record SmtpSettingsDto(
    string? Host,
    int Port,
    string? Username,
    bool HasPassword,
    string Security,
    string? FromAddress,
    string? FromName,
    string? PublicUrl,
    bool IsConfigured,
    bool IsFromEnvironment);

public sealed record SmtpTestInput(string? To);

/// <summary>
/// SMTP settings: setting row 'Smtp' (password encrypted with Data Protection), overridden entirely
/// by the configuration section "Smtp" (environment variables Smtp__*) when Smtp:Host is set.
/// </summary>
public sealed class SmtpSettingsStore(NpgsqlDataSource dataSource, IDataProtectionProvider dataProtection, IConfiguration configuration)
{
    public const string SettingName = "Smtp";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IDataProtector protector = dataProtection.CreateProtector("LogHub.Smtp");

    public bool IsFromEnvironment => !string.IsNullOrWhiteSpace(configuration["Smtp:Host"]);

    public async Task<SmtpSettingsDto> GetAsync(CancellationToken cancellationToken)
    {
        var values = IsFromEnvironment ? FromEnvironment() : await ReadStoredAsync(cancellationToken) ?? new StoredSmtp();
        return new SmtpSettingsDto(
            values.Host,
            values.Port,
            values.Username,
            !string.IsNullOrEmpty(values.Password),
            values.Security,
            values.FromAddress,
            values.FromName,
            values.PublicUrl,
            values.IsConfigured,
            IsFromEnvironment);
    }

    /// <summary>The configuration used to send emails, or null when SMTP is not configured.</summary>
    public async Task<SmtpConfiguration?> GetConfigurationAsync(CancellationToken cancellationToken)
    {
        string? password;
        StoredSmtp? values;
        if (IsFromEnvironment)
        {
            values = FromEnvironment();
            password = values.Password;
        }
        else
        {
            values = await ReadStoredAsync(cancellationToken);
            try
            {
                password = string.IsNullOrEmpty(values?.Password) ? null : protector.Unprotect(values.Password);
            }
            catch (CryptographicException ex)
            {
                throw new InvalidOperationException("The stored SMTP password cannot be decrypted (Data Protection keys changed). Save the SMTP settings again.", ex);
            }
        }

        return values is { IsConfigured: true }
            ? new SmtpConfiguration(values.Host!, values.Port, values.Username, password, values.Security, values.FromAddress!, values.FromName, values.PublicUrl)
            : null;
    }

    /// <summary>Saves validated input (see <see cref="SmtpSettingsEndpoints.Validate"/>).</summary>
    public async Task SaveAsync(SmtpSettingsInput input, long? userId, CancellationToken cancellationToken)
    {
        var current = await ReadStoredAsync(cancellationToken);
        var security = SmtpSecurity.Normalize(input.Security) ?? SmtpSecurity.StartTls;
        var value = new StoredSmtp
        {
            Host = input.Host!.Trim(),
            Port = input.Port ?? SmtpSecurity.DefaultPort(security),
            Username = NullIfEmpty(input.Username),
            Password = input.Password switch
            {
                null => current?.Password,
                "" => null,
                var password => protector.Protect(password),
            },
            Security = security,
            FromAddress = input.FromAddress!.Trim(),
            FromName = NullIfEmpty(input.FromName),
            PublicUrl = NullIfEmpty(input.PublicUrl)?.TrimEnd('/'),
        };

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into setting (name, value, user_created_id)
            values (@name, @value::jsonb, @userId)
            on conflict (name) do update
            set value = excluded.value, user_updated_id = @userId, user_updated_date = now()
            """,
            new { name = SettingName, value = JsonSerializer.Serialize(value, Json), userId },
            cancellationToken: cancellationToken));
    }

    private async Task<StoredSmtp?> ReadStoredAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var json = await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """select value::text from setting where name = @name""", new { name = SettingName }, cancellationToken: cancellationToken));
        return string.IsNullOrEmpty(json) ? null : JsonSerializer.Deserialize<StoredSmtp>(json, Json);
    }

    private StoredSmtp FromEnvironment()
    {
        var section = configuration.GetSection("Smtp");
        var security = SmtpSecurity.Normalize(section["Security"]) ?? SmtpSecurity.StartTls;
        return new StoredSmtp
        {
            Host = section["Host"]?.Trim(),
            Port = int.TryParse(section["Port"], NumberStyles.None, CultureInfo.InvariantCulture, out var port) ? port : SmtpSecurity.DefaultPort(security),
            Username = NullIfEmpty(section["Username"]),
            Password = NullIfEmpty(section["Password"]),
            Security = security,
            FromAddress = NullIfEmpty(section["FromAddress"]),
            FromName = NullIfEmpty(section["FromName"]),
            PublicUrl = NullIfEmpty(section["PublicUrl"])?.TrimEnd('/'),
        };
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>JSON stored in setting.value. Password is the Data Protection payload (clear text only when read from the environment).</summary>
    private sealed record StoredSmtp
    {
        public string? Host { get; init; }

        public int Port { get; init; } = SmtpSecurity.DefaultPort(SmtpSecurity.StartTls);

        public string? Username { get; init; }

        public string? Password { get; init; }

        public string Security { get; init; } = SmtpSecurity.StartTls;

        public string? FromAddress { get; init; }

        public string? FromName { get; init; }

        public string? PublicUrl { get; init; }

        public bool IsConfigured => !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(FromAddress);
    }
}

/// <summary>/api/v1/settings/smtp (System permission).</summary>
public static class SmtpSettingsEndpoints
{
    public static async Task<IResult> Get(SmtpSettingsStore store, CancellationToken cancellationToken) =>
        Results.Ok(await store.GetAsync(cancellationToken));

    public static async Task<IResult> Update(
        SmtpSettingsInput input,
        ClaimsPrincipal user,
        SmtpSettingsStore store,
        CancellationToken cancellationToken)
    {
        if (store.IsFromEnvironment)
        {
            return ApiErrors.Result(StatusCodes.Status409Conflict, "SMTP is configured by environment variables (Smtp__*) and cannot be changed here.");
        }

        if (Validate(input) is { } error)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, error);
        }

        await store.SaveAsync(input, user.GetUserId(), cancellationToken);
        return Results.Ok(await store.GetAsync(cancellationToken));
    }

    /// <summary>POST /api/v1/settings/smtp/test: sends a test email with the current settings.</summary>
    public static async Task<IResult> Test(
        SmtpTestInput input,
        SmtpSettingsStore store,
        IEmailSender sender,
        ILogger<SmtpSettingsStore> logger,
        CancellationToken cancellationToken)
    {
        if (!EmailAddress.IsValid(input.To?.Trim()))
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "to must be a valid email address.");
        }

        SmtpConfiguration? smtp;
        try
        {
            smtp = await store.GetConfigurationAsync(cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return ApiErrors.Result(StatusCodes.Status502BadGateway, ex.Message);
        }

        if (smtp is null)
        {
            return ApiErrors.Result(StatusCodes.Status400BadRequest, "SMTP is not configured.");
        }

        var message = new EmailMessage(
            [input.To!.Trim()],
            "[LogHub] Test email",
            "This is a test email from LogHub. SMTP settings work.",
            "<p>This is a test email from LogHub. SMTP settings work.</p>");
        try
        {
            await sender.SendAsync(smtp, message, cancellationToken);
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "SMTP test email to {Host}:{Port} failed", smtp.Host, smtp.Port);
            return ApiErrors.Result(StatusCodes.Status502BadGateway, $"Sending failed: {ex.Message}");
        }

        return Results.NoContent();
    }

    /// <summary>Returns the first validation error, or null.</summary>
    public static string? Validate(SmtpSettingsInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Host) || input.Host.Trim().Length > 255)
        {
            return "host is required (at most 255 characters).";
        }

        if (input.Port is < 1 or > 65535)
        {
            return "port must be between 1 and 65535.";
        }

        if (input.Security is not null && SmtpSecurity.Normalize(input.Security) is null)
        {
            return "security must be None, StartTls or SslOnConnect.";
        }

        if (!EmailAddress.IsValid(input.FromAddress?.Trim()))
        {
            return "fromAddress must be a valid email address.";
        }

        if (!string.IsNullOrWhiteSpace(input.PublicUrl)
            && !(Uri.TryCreate(input.PublicUrl.Trim(), UriKind.Absolute, out var url) && (url.Scheme == Uri.UriSchemeHttp || url.Scheme == Uri.UriSchemeHttps)))
        {
            return "publicUrl must be an absolute http or https URL.";
        }

        return null;
    }
}
