using LogHub.Api.Common.Security;
using Microsoft.AspNetCore.Antiforgery;

namespace LogHub.Api.Features.Auth;

/// <summary>Marks endpoints that skip the CSRF check (login: no session yet).</summary>
public sealed class SkipCsrfAttribute : Attribute;

/// <summary>Marks endpoints reachable while a password change is pending (/auth/*).</summary>
public sealed class AllowPendingPasswordChangeAttribute : Attribute;

/// <summary>
/// Runs on every /api/v1 endpoint:
/// - browser sessions must send the antiforgery token (X-XSRF-TOKEN) on unsafe methods; API keys are exempt;
/// - sessions that must change their password are blocked outside /auth/*.
/// </summary>
public sealed class ApiGuardFilter(IAntiforgery antiforgery) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var metadata = http.GetEndpoint()?.Metadata;
        var isSession = http.User.GetUserId() is not null;

        if (isSession && !HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method)
            && metadata?.GetMetadata<SkipCsrfAttribute>() is null)
        {
            try
            {
                await antiforgery.ValidateRequestAsync(http);
            }
            catch (AntiforgeryValidationException)
            {
                return ApiErrors.Result(StatusCodes.Status400BadRequest, "Missing or invalid CSRF token.", "csrf");
            }
        }

        if (isSession && http.User.HasClaim(LogHubClaims.MustChangePassword, "true")
            && metadata?.GetMetadata<AllowPendingPasswordChangeAttribute>() is null)
        {
            return ApiErrors.Result(StatusCodes.Status403Forbidden, "Change your password to continue.", "password_change_required");
        }

        return await next(context);
    }
}
