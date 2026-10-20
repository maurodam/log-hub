using System.Net.Http.Json;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;

namespace LogHub.IntegrationTests;

public sealed record MailpitAddress(string? Name, string Address);

public sealed record MailpitMessage(string Id, MailpitAddress From, List<MailpitAddress> To, string Subject);

public sealed record MailpitMessageDetail(string Id, string Subject, string Text, string Html);

/// <summary>Mailpit SMTP test server in Docker: SMTP on 1025, HTTP API on 8025.</summary>
public sealed class MailpitFixture : IAsyncLifetime
{
    private const int SmtpPort = 1025;
    private const int HttpPort = 8025;

    private readonly IContainer container = new ContainerBuilder("axllent/mailpit:v1.27")
        .WithPortBinding(SmtpPort, true)
        .WithPortBinding(HttpPort, true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(request => request.ForPort(HttpPort).ForPath("/api/v1/messages")))
        .Build();

    private HttpClient? api;

    public string Host => container.Hostname;

    public int Port => container.GetMappedPublicPort(SmtpPort);

    private HttpClient Api => api ?? throw new InvalidOperationException("Fixture is not initialized.");

    public async ValueTask InitializeAsync()
    {
        await container.StartAsync();
        api = new HttpClient { BaseAddress = new Uri($"http://{container.Hostname}:{container.GetMappedPublicPort(HttpPort)}") };
    }

    public async ValueTask DisposeAsync()
    {
        api?.Dispose();
        await container.DisposeAsync();
    }

    /// <summary>Messages sent to the address, polling until at least <paramref name="expected"/> arrived (10 s at most).</summary>
    public async Task<List<MailpitMessage>> WaitForMessagesAsync(string to, int expected)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (true)
        {
            var list = await Api.GetFromJsonAsync<MessageList>("/api/v1/messages?limit=500", TestApi.Json, TestContext.Current.CancellationToken);
            var messages = (list?.Messages ?? [])
                .Where(m => m.To.Any(address => string.Equals(address.Address, to, StringComparison.OrdinalIgnoreCase)))
                .ToList();

            if (messages.Count >= expected || DateTime.UtcNow > deadline)
            {
                return messages;
            }

            await Task.Delay(100, TestContext.Current.CancellationToken);
        }
    }

    public async Task<MailpitMessageDetail> GetMessageAsync(string id) =>
        await Api.GetFromJsonAsync<MailpitMessageDetail>($"/api/v1/message/{id}", TestApi.Json, TestContext.Current.CancellationToken)
            ?? throw new InvalidOperationException("Empty response.");

    private sealed record MessageList(List<MailpitMessage> Messages);
}
