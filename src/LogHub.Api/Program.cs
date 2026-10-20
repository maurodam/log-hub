using DotNetEnv;
using LogHub.Api.Common.Security;
using LogHub.Api.Features.Alerts;
using LogHub.Api.Features.ApiKeys;
using LogHub.Api.Features.Auth;
using LogHub.Api.Features.Events;
using LogHub.Api.Features.Health;
using LogHub.Api.Features.Ingestion;
using LogHub.Api.Features.Retention;
using LogHub.Api.Features.Signals;
using LogHub.Api.Features.Stats;
using LogHub.Api.Features.Users;
using LogHub.Db;
using Serilog;
using Serilog.Events;

Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // Local development reads secrets (connection string) from the repository .env file.
    if (builder.Environment.IsDevelopment())
    {
        var dotEnv = new Dictionary<string, string?>();
        foreach (var (key, value) in Env.NoEnvVars().TraversePath().Load())
        {
            dotEnv[key.Replace("__", ":")] = value;
        }

        builder.Configuration.AddInMemoryCollection(dotEnv);
    }

    builder.Services.AddSerilog((services, configuration) => configuration
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext());

    var connectionString = builder.Configuration.GetConnectionString("LogHub")
        ?? throw new InvalidOperationException("Connection string 'LogHub' is missing. Set ConnectionStrings__LogHub (see .env.example).");

    // Columns are snake_case (api_key_id), C# properties PascalCase (ApiKeyId).
    Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
    builder.Services.AddNpgsqlDataSource(connectionString);
    builder.Services.AddHttpHardening(builder.Configuration);
    builder.Services.AddLogHubDataProtection(builder.Configuration);
    builder.Services.AddLogHubAuthentication(builder.Configuration, builder.Environment);
    builder.Services.AddLogHubAuthorization();
    builder.Services.AddIngestion(builder.Configuration);
    builder.Services.AddEvents(builder.Configuration);
    builder.Services.AddRetention(builder.Configuration);
    builder.Services.AddAlerts(builder.Configuration);

    var app = builder.Build();

    if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
    {
        DatabaseMigrator.Migrate(connectionString, app.Services.GetRequiredService<ILogger<Program>>());
    }

    await UserBootstrapper.EnsureAdminAsync(app.Services);
    DataProtectionSetup.WarnIfUnprotected(app);
    await RetentionDefaults.ApplyAsync(app.Services);

    app.UseHttpHardening();

    app.UseSerilogRequestLogging(options => options.GetLevel = (context, _, exception) =>
        exception is not null || context.Response.StatusCode >= 500 ? LogEventLevel.Error
        : IsIngestion(context.Request.Path) ? LogEventLevel.Verbose
        : LogEventLevel.Information);
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.UseAuthentication();
    app.UseAuthorization();
    app.UseRateLimiter();

    app.MapHealth();
    app.MapIngestion();

    var api = app.MapGroup("/api/v1")
        .RequireAuthorization()
        .AddEndpointFilter<ApiGuardFilter>();
    api.MapAuth();
    api.MapEvents();
    api.MapStats();
    api.MapSignals();
    api.MapApiKeys();
    api.MapUsers();
    api.MapRetention();
    api.MapAlerts();

    // Unknown API routes return 404; every other route serves the Angular app.
    app.MapFallback("/api/{**path}", () => Results.NotFound());
    app.MapFallbackToFile("index.html");

    app.Run();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "LogHub terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}

// High-volume ingestion requests are not worth an Information log line each.
static bool IsIngestion(PathString path) =>
    path.StartsWithSegments("/api/events/raw") || path.StartsWithSegments("/ingest");

public partial class Program;
