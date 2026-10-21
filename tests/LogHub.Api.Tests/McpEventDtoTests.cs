using System.Text.Json;
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Server;
using Npgsql;
using LogHub.Api.Features.Events;
using LogHub.Api.Features.Mcp;

namespace LogHub.Api.Tests;

public sealed class McpEventDtoTests
{
    [Fact]
    public void Search_truncates_message_and_exception_but_detail_preserves_them()
    {
        var item = Event(new string('m', 1500), new string('e', 2500));
        var search = McpEventDto.From(item, 1000, 2000);
        Assert.Equal(new string('m', 1000) + "… [truncated 500 chars]", search.Message);
        Assert.Equal(new string('e', 2000) + "… [truncated 500 chars]", search.Exception);
        var detail = McpEventDto.From(item, 16000, 16000);
        Assert.Equal(item.Message, detail.Message);
        Assert.Equal(item.Exception, detail.Exception);
        Assert.Equal(item.Properties, detail.Properties);
    }

    [Fact]
    public void Detail_truncates_at_16000_and_preserves_nulls()
    {
        var detail = McpEventDto.From(Event(new string('m', 16001), null), 16000, 16000);
        Assert.Equal(new string('m', 16000) + "… [truncated 1 chars]", detail.Message);
        Assert.Null(detail.Exception);
    }

    [Fact]
    public void Truncation_keeps_surrogate_pairs_intact()
    {
        var detail = McpEventDto.From(Event("abc😀x", null), 4, 4);
        Assert.Equal("abc… [truncated 3 chars]", detail.Message);
    }

    [Fact]
    public void Tool_schemas_hide_injected_parameters_and_mark_read_only()
    {
        using var dataSource = NpgsqlDataSource.Create("Host=localhost;Database=unused;Username=unused");
        using var services = new ServiceCollection().BuildServiceProvider();
        var target = new LogHubTools(new EventFilterBuilder(dataSource), dataSource);
        var methods = typeof(LogHubTools).GetMethods().Where(m => m.GetCustomAttribute<McpServerToolAttribute>() is not null).ToArray();
        Assert.Equal(4, methods.Length);
        foreach (var method in methods)
        {
            var tool = McpServerTool.Create(method, target, new McpServerToolCreateOptions { Services = services });
            Assert.True(tool.ProtocolTool.Annotations?.ReadOnlyHint);
            var properties = tool.ProtocolTool.InputSchema.GetProperty("properties");
            Assert.False(properties.TryGetProperty("user", out _));
            Assert.False(properties.TryGetProperty("cancellationToken", out _));
        }
    }

    private static LogEventDto Event(string message, string? exception) => new(1, DateTimeOffset.UtcNow,
        DateTimeOffset.UtcNow, "Error", 4, null, message, exception, "$00000000", "trace", null, 2,
        JsonSerializer.Deserialize<JsonElement>("{\"Name\":\"Value\"}"));
}
