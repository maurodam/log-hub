using LogHub.Api.Features.Alerts.Webhooks;

namespace LogHub.Api.Tests.Security;

public class WebhookOptionsTests
{
    [Theory]
    [InlineData("teams", "https://prod-1.westeurope.logic.azure.com/workflows/a", true)]
    [InlineData("teams", "https://test.environment.api.powerplatform.com/workflows/a", true)]
    [InlineData("slack", "https://hooks.slack.com/services/a/b/c", true)]
    [InlineData("slack", "https://hooks.slack.com.evil.example/services/a/b/c", false)]
    [InlineData("generic", "https://webhook.example.org/alerts", true)]
    [InlineData("generic", "http://webhook.example.org/alerts", false)]
    [InlineData("generic", "https://webhook.example.org:444/alerts", false)]
    [InlineData("generic", "https://user@webhook.example.org/alerts", false)]
    [InlineData("generic", "https://unregistered.example.org/alerts", false)]
    public void Accepts_only_configured_https_hosts(string kind, string url, bool expected) =>
        Assert.Equal(expected, new WebhookOptions { AllowedGenericHosts = ["webhook.example.org"] }.TryDestination(kind, url, out _));
}
