using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LogHub.IntegrationTests;

/// <summary>Session login, CSRF, lockout, forced password change, session revocation and security headers.</summary>
[Collection(LogHubCollection.Name)]
public class AuthTests(LogHubFixture fixture)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Admin_signs_in_and_gets_all_permissions()
    {
        using var client = await fixture.CreateSessionClientAsync();

        var me = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct);

        Assert.Equal("admin", me.GetProperty("username").GetString());
        Assert.Equal("Local", me.GetProperty("authProvider").GetString());
        var permissions = me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ToHashSet();
        Assert.Superset(new HashSet<string?> { "Read", "Write", "Project", "Organization", "System" }, permissions);
    }

    [Fact]
    public async Task Wrong_password_is_rejected_without_revealing_the_reason()
    {
        using var client = HttpsClient();

        using var wrongPassword = await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "admin", password = "not-the-password" }, Ct);
        using var unknownUser = await client.PostAsJsonAsync("/api/v1/auth/login", new { username = "nobody", password = "not-the-password" }, Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownUser.StatusCode);
        Assert.Equal(await Error(wrongPassword), await Error(unknownUser));
    }

    [Fact]
    public async Task Api_requires_a_session_or_api_key()
    {
        using var client = HttpsClient();

        using var response = await client.GetAsync("/api/v1/events", Ct);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Unsafe_requests_from_a_session_need_the_csrf_token()
    {
        using var client = await fixture.CreateSessionClientAsync();
        var signal = new { title = "csrf", filter = new { text = "x" }, isShared = false };

        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        using var withoutToken = await client.PostAsJsonAsync("/api/v1/signals", signal, Ct);
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", "forged");
        using var forgedToken = await client.PostAsJsonAsync("/api/v1/signals", signal, Ct);

        Assert.Equal(HttpStatusCode.BadRequest, withoutToken.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, forgedToken.StatusCode);
        Assert.Contains("CSRF", await Error(withoutToken));
    }

    [Fact]
    public async Task Logout_ends_the_session()
    {
        using var client = await fixture.CreateSessionClientAsync();

        using var logout = await client.PostAsync("/api/v1/auth/logout", null, Ct);
        using var me = await client.GetAsync("/api/v1/auth/me", Ct);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task Account_locks_after_repeated_failures()
    {
        var (username, password) = await CreateUserAsync(roleTitle: "User (read-only)");
        using var client = HttpsClient();

        for (var i = 0; i < 5; i++)
        {
            using var failed = await client.PostAsJsonAsync("/api/v1/auth/login", new { username, password = "wrong-password-123" }, Ct);
            Assert.Equal(HttpStatusCode.Unauthorized, failed.StatusCode);
        }

        using var locked = await client.PostAsJsonAsync("/api/v1/auth/login", new { username, password }, Ct);
        using var wrong = await client.PostAsJsonAsync("/api/v1/auth/login", new { username, password = "wrong-password-123" }, Ct);

        // Even the right password is refused, with the same message as a wrong one (no account enumeration).
        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
        Assert.Equal(await Error(wrong), await Error(locked));
    }

    [Fact]
    public async Task Organization_owner_cannot_escalate_to_administrator()
    {
        var (username, password) = await CreateUserAsync(roleTitle: "Organization Owner");
        using var owner = await fixture.CreateSessionClientAsync(username, password);
        var roles = await owner.GetFromJsonAsync<JsonElement>("/api/v1/roles", Ct);
        var adminRole = roles.EnumerateArray().Single(r => r.GetProperty("title").GetString() == "Administrator").GetProperty("id").GetInt64();
        var users = await owner.GetFromJsonAsync<JsonElement>("/api/v1/users", Ct);
        var adminId = users.EnumerateArray().Single(u => u.GetProperty("username").GetString() == "admin").GetProperty("id").GetInt64();
        var me = await owner.GetFromJsonAsync<JsonElement>("/api/v1/auth/me", Ct);
        var ownId = me.GetProperty("id").GetInt64();

        using var createAdmin = await owner.PostAsJsonAsync("/api/v1/users", new { username = $"x{Guid.NewGuid():N}"[..12], password = "Another-Password-123", roleIds = new[] { adminRole } }, Ct);
        using var promoteSelf = await owner.PutAsJsonAsync($"/api/v1/users/{ownId}", new { displayName = "me", roleIds = new[] { adminRole }, isDisabled = false }, Ct);
        using var resetAdmin = await owner.PostAsJsonAsync($"/api/v1/users/{adminId}/password", new { newPassword = "Taken-Over-Password-1", mustChangePassword = false }, Ct);
        using var disableAdmin = await owner.PutAsJsonAsync($"/api/v1/users/{adminId}", new { displayName = "x", roleIds = Array.Empty<long>(), isDisabled = true }, Ct);
        using var deleteAdmin = await owner.DeleteAsync($"/api/v1/users/{adminId}", Ct);

        Assert.Equal(HttpStatusCode.Forbidden, createAdmin.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, promoteSelf.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, resetAdmin.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, disableAdmin.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, deleteAdmin.StatusCode);
    }

    [Fact]
    public async Task Forced_password_change_blocks_the_api_until_done()
    {
        var (username, password) = await CreateUserAsync(roleTitle: "User (read-only)", mustChangePassword: true);
        using var client = await fixture.CreateSessionClientAsync(username, password);

        using var blocked = await client.GetAsync("/api/v1/events", Ct);
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Contains("password_change_required", await blocked.Content.ReadAsStringAsync(Ct));

        using var tooShort = await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = password, newPassword = "short" }, Ct);
        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);

        using var changed = await client.PostAsJsonAsync("/api/v1/auth/change-password", new { currentPassword = password, newPassword = "A-brand-new-password-42" }, Ct);
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", LogHubFixture.XsrfToken(changed));

        using var allowed = await client.GetAsync("/api/v1/events?count=1", Ct);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
    }

    [Fact]
    public async Task Changing_roles_revokes_existing_sessions()
    {
        var (username, password) = await CreateUserAsync(roleTitle: "User (read-only)");
        using var user = await fixture.CreateSessionClientAsync(username, password);
        using var before = await user.GetAsync("/api/v1/events?count=1", Ct);
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        using var admin = await fixture.CreateSessionClientAsync();
        var users = await admin.GetFromJsonAsync<JsonElement>("/api/v1/users", Ct);
        var id = users.EnumerateArray().Single(u => u.GetProperty("username").GetString() == username).GetProperty("id").GetInt64();
        using var update = await admin.PutAsJsonAsync($"/api/v1/users/{id}", new { displayName = "Changed", roleIds = Array.Empty<long>(), isDisabled = false }, Ct);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);

        using var after = await user.GetAsync("/api/v1/events?count=1", Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    [Fact]
    public async Task Responses_carry_security_headers()
    {
        using var client = HttpsClient();

        using var response = await client.GetAsync("/health", Ct);

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());

        using var api = await client.GetAsync("/api/v1/auth/providers", Ct);
        Assert.True(api.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Providers_endpoint_is_public()
    {
        using var client = HttpsClient();

        var providers = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/providers", Ct);

        Assert.True(providers.GetProperty("local").GetBoolean());
        Assert.False(providers.GetProperty("oidc").GetProperty("enabled").GetBoolean());
    }

    private HttpClient HttpsClient() =>
        fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

    private async Task<(string Username, string Password)> CreateUserAsync(string roleTitle, bool mustChangePassword = false)
    {
        using var admin = await fixture.CreateSessionClientAsync();
        var roles = await admin.GetFromJsonAsync<JsonElement>("/api/v1/roles", Ct);
        var roleId = roles.EnumerateArray().Single(r => r.GetProperty("title").GetString() == roleTitle).GetProperty("id").GetInt64();
        var username = $"user-{Guid.NewGuid():N}"[..20];
        const string password = "Initial-Password-123";

        using var response = await admin.PostAsJsonAsync("/api/v1/users", new
        {
            username,
            displayName = "Test user",
            email = $"{username}@example.com",
            password,
            roleIds = new[] { roleId },
            mustChangePassword,
        }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (username, password);
    }

    private static async Task<string> Error(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement.GetProperty("error").GetString() ?? string.Empty;
}
