using System.Reflection;
using DbUp;
using DbUp.Engine;
using DbUp.Engine.Output;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace LogHub.Db;

/// <summary>
/// Applies the embedded SQL scripts with DbUp, in this order:
/// Scripts/Tables (one CREATE TABLE per file), Scripts/Seed (built-in data), Scripts/Migrations (changes after the first release).
/// Each script runs once; executed scripts are recorded in schema_version.
/// A PostgreSQL advisory lock serializes replicas that start at the same time.
/// </summary>
public static class DatabaseMigrator
{
    private const long MigrationLockKey = 0x4C6F674875624462; // "LogHubDb"

    public static void Migrate(string connectionString, ILogger logger)
    {
        var log = new MicrosoftUpgradeLog(logger);
        var assembly = Assembly.GetExecutingAssembly();

        EnsureDatabase.For.PostgresqlDatabase(connectionString, log);

        using var lockConnection = new NpgsqlConnection(connectionString);
        lockConnection.Open();
        using (var acquire = new NpgsqlCommand($"select pg_advisory_lock({MigrationLockKey})", lockConnection))
        {
            acquire.ExecuteNonQuery();
        }

        try
        {
            var upgrader = DeployChanges.To
                .PostgresqlDatabase(connectionString)
                .WithScriptsEmbeddedInAssembly(assembly, name => name.Contains(".Scripts.Tables."), new SqlScriptOptions { RunGroupOrder = 1 })
                .WithScriptsEmbeddedInAssembly(assembly, name => name.Contains(".Scripts.Seed."), new SqlScriptOptions { RunGroupOrder = 2 })
                .WithScriptsEmbeddedInAssembly(assembly, name => name.Contains(".Scripts.Migrations."), new SqlScriptOptions { RunGroupOrder = 3 })
                .JournalToPostgresqlTable("public", "schema_version")
                .WithTransactionPerScript()
                .LogTo(log)
                .Build();

            var result = upgrader.PerformUpgrade();
            if (!result.Successful)
            {
                throw new InvalidOperationException($"Database migration failed on script '{result.ErrorScript?.Name}'.", result.Error);
            }
        }
        finally
        {
            using var release = new NpgsqlCommand($"select pg_advisory_unlock({MigrationLockKey})", lockConnection);
            release.ExecuteNonQuery();
        }
    }
}
