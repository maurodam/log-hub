using System.Globalization;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Common.Security;

/// <summary>
/// Authenticates API calls with an API key: X-Api-Key header (X-Seq-ApiKey also accepted).
/// The ?apiKey= query parameter is accepted only by the live-tail stream (EventSource cannot set headers):
/// URLs end up in proxy logs and browser history, so keys stay out of them elsewhere.
/// Each key permission becomes a permission claim.
/// </summary>
public sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    ApiKeyStore apiKeys) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiKey";

    private static readonly PathString StreamPath = "/api/v1/events/stream";

    public static bool HasApiKey(HttpRequest request) =>
        request.Headers.ContainsKey("X-Api-Key") || request.Headers.ContainsKey("X-Seq-ApiKey") || QueryToken(request) is not null;

    private static string? QueryToken(HttpRequest request) =>
        request.Path.StartsWithSegments(StreamPath) ? request.Query["apiKey"].FirstOrDefault() : null;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = Request.Headers["X-Api-Key"].FirstOrDefault()
            ?? Request.Headers["X-Seq-ApiKey"].FirstOrDefault()
            ?? QueryToken(Request);

        if (string.IsNullOrEmpty(token))
        {
            return AuthenticateResult.NoResult();
        }

        var apiKey = await apiKeys.FindByTokenAsync(token, Context.RequestAborted);
        if (apiKey is null)
        {
            return AuthenticateResult.Fail("The API key is not valid.");
        }

        var claims = apiKey.Permissions
            .Select(permission => new Claim(LogHubClaims.Permission, permission))
            .Append(new Claim(LogHubClaims.ApiKeyId, apiKey.Id.ToString(CultureInfo.InvariantCulture)));

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties) =>
        ApiErrors.WriteAsync(Context, StatusCodes.Status401Unauthorized, "A valid API key or session is required.");

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        ApiErrors.WriteAsync(Context, StatusCodes.Status403Forbidden, "Missing permission for this operation.");
}

public static class ApiErrors
{
    public static IResult Result(int statusCode, string message, string? code = null) =>
        Results.Json(Body(message, code), statusCode: statusCode);

    public static Task WriteAsync(HttpContext context, int statusCode, string message, string? code = null)
    {
        context.Response.StatusCode = statusCode;
        return context.Response.WriteAsJsonAsync(Body(message, code));
    }

    private static object Body(string message, string? code) =>
        code is null ? new { error = message } : new { error = message, code };
}
