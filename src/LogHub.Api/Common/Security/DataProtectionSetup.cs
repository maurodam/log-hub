using System.Security.Cryptography.X509Certificates;
using System.Xml.Linq;
using Azure.Identity;
using Dapper;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogHub.Api.Common.Security;

/// <summary>
/// Data Protection keys (session cookies, antiforgery tokens, encrypted settings) live in PostgreSQL,
/// so every replica shares them and sessions survive restarts.
/// Protect the key ring at rest, otherwise anyone who can read the database can forge sessions and decrypt the SMTP password:
/// - Azure: DataProtection:KeyVaultKeyUri (Key Vault key, managed identity);
/// - elsewhere: DataProtection:CertificatePath (+ CertificatePassword), a PFX file mounted into the container.
/// </summary>
public static class DataProtectionSetup
{
    public static IServiceCollection AddLogHubDataProtection(this IServiceCollection services, IConfiguration configuration)
    {
        var builder = services.AddDataProtection().SetApplicationName("LogHub");

        if (configuration["DataProtection:KeyVaultKeyUri"] is { Length: > 0 } keyUri)
        {
            builder.ProtectKeysWithAzureKeyVault(new Uri(keyUri), new DefaultAzureCredential());
        }
        else if (configuration["DataProtection:CertificatePath"] is { Length: > 0 } certificatePath)
        {
            builder.ProtectKeysWithCertificate(
                X509CertificateLoader.LoadPkcs12FromFile(certificatePath, configuration["DataProtection:CertificatePassword"]));
        }

        services.AddSingleton<IConfigureOptions<KeyManagementOptions>>(provider =>
            new ConfigureOptions<KeyManagementOptions>(options =>
                options.XmlRepository = new PostgresXmlRepository(provider.GetRequiredService<NpgsqlDataSource>())));

        return services;
    }

    public static void WarnIfUnprotected(WebApplication app)
    {
        var configuration = app.Configuration;
        var isProtected = !string.IsNullOrEmpty(configuration["DataProtection:KeyVaultKeyUri"])
            || !string.IsNullOrEmpty(configuration["DataProtection:CertificatePath"]);
        if (!app.Environment.IsDevelopment() && !isProtected)
        {
            app.Logger.LogWarning(
                "Data Protection keys are stored unencrypted in the database. Set DataProtection__KeyVaultKeyUri (Azure) or DataProtection__CertificatePath to protect sessions and stored secrets");
        }
    }
}

public sealed class PostgresXmlRepository(NpgsqlDataSource dataSource) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements()
    {
        using var connection = dataSource.OpenConnection();
        return connection.Query<string>("""select xml from data_protection_key order by id """)
            .Select(xml => XElement.Parse(xml))
            .ToList();
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        using var connection = dataSource.OpenConnection();
        connection.Execute(
            """insert into data_protection_key (friendly_name, xml) values (@friendlyName, @xml)""",
            new { friendlyName, xml = element.ToString(SaveOptions.DisableFormatting) });
    }
}
