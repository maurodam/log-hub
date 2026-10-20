using LogHub.Api.Features.Alerts;
using LogHub.Api.Features.Auth;
using LogHub.Api.Features.Events;
using LogHub.Api.Features.Ingestion;
using Microsoft.Extensions.Options;

namespace LogHub.Api.Tests.Security;

public class HardeningTests
{
    [Theory]
    [InlineData("https://login.microsoftonline.com/common/v2.0", true)]
    [InlineData("https://login.microsoftonline.com/organizations/v2.0", true)]
    [InlineData("https://login.microsoftonline.com/7f1c2b3a-0000-4000-8000-000000000001/v2.0", false)]
    public void Detects_multi_tenant_authorities(string authority, bool expected) =>
        Assert.Equal(expected, new OidcOptions { Authority = authority }.IsMultiTenantAuthority);

    [Theory]
    [InlineData(new string[0], null, true)]
    [InlineData(new[] { "tenant-a" }, "TENANT-A", true)]
    [InlineData(new[] { "tenant-a" }, "tenant-b", false)]
    [InlineData(new[] { "tenant-a" }, null, false)]
    public void Only_allowed_tenants_sign_in(string[] allowed, string? tenantId, bool expected) =>
        Assert.Equal(expected, OidcUserMapper.IsAllowedTenant(new OidcOptions { AllowedTenants = allowed }, tenantId));

    [Theory]
    [InlineData(new string[0], "anyone@example.org", true)]
    [InlineData(new[] { "contoso.com" }, "ops@contoso.com", true)]
    [InlineData(new[] { "@contoso.com" }, "OPS@CONTOSO.COM", true)]
    [InlineData(new[] { "contoso.com" }, "ops@evilcontoso.com", false)]
    [InlineData(new[] { "contoso.com" }, "ops@contoso.com.evil.org", false)]
    public void Alert_recipients_respect_allowed_domains(string[] domains, string email, bool expected) =>
        Assert.Equal(expected, new AlertOptions { AllowedRecipientDomains = domains }.IsAllowedRecipient(email));

    [Fact]
    public void Event_queue_is_bounded_by_events_not_requests()
    {
        var queue = new EventQueue(Options.Create(new IngestionOptions { MaxQueuedEvents = 3 }));

        Assert.True(queue.TryEnqueue(Batch(2)));
        Assert.False(queue.TryEnqueue(Batch(2)));
        Assert.True(queue.TryEnqueue(Batch(1)));
        Assert.Equal(3, queue.PendingEvents);

        queue.Release(3);
        Assert.True(queue.TryEnqueue(Batch(10)));
    }

    [Fact]
    public void Stream_limiter_caps_open_streams_per_owner()
    {
        var limiter = new StreamLimiter(Options.Create(new EventsOptions { MaxStreamsPerUser = 2 }));

        Assert.True(limiter.TryAcquire("user:1"));
        Assert.True(limiter.TryAcquire("user:1"));
        Assert.False(limiter.TryAcquire("user:1"));
        Assert.True(limiter.TryAcquire("user:2"));

        limiter.Release("user:1");
        Assert.True(limiter.TryAcquire("user:1"));
    }

    [Fact]
    public void Login_throttle_blocks_one_account_from_one_ip()
    {
        using var throttle = new LoginThrottle(Options.Create(new AuthOptions { MaxFailedLogins = 2 }));

        throttle.RecordFailure(1, "10.0.0.1");
        throttle.RecordFailure(1, "10.0.0.1");

        Assert.True(throttle.IsBlocked(1, "10.0.0.1"));
        Assert.False(throttle.IsBlocked(1, "10.0.0.2"));
        Assert.False(throttle.IsBlocked(2, "10.0.0.1"));

        throttle.Reset(1, "10.0.0.1");
        Assert.False(throttle.IsBlocked(1, "10.0.0.1"));
    }

    private static IngestionBatch Batch(int events) =>
        new(null, DateTimeOffset.UtcNow, Enumerable.Range(0, events)
            .Select(_ => new IngestedEvent(DateTimeOffset.UtcNow, "Information", 2, null, "m", null, 0, null, null, null, null, null, "{}", null, null, null))
            .ToList());
}
