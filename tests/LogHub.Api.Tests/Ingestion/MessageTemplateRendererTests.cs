using System.Text.Json;
using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Tests.Ingestion;

public class MessageTemplateRendererTests
{
    [Theory]
    [InlineData("Hello {Name}", "Hello World")]
    [InlineData("Hello {@Name} and {$Name}", "Hello World and World")]
    [InlineData("Count {Count,5}", "Count 3")]
    [InlineData("Literal {{braces}} {Name}", "Literal {braces} World")]
    [InlineData("Missing {Other}", "Missing {Other}")]
    [InlineData("Object {Order}", """Object {"Id":7}""")]
    [InlineData("Null {Nothing}", "Null null")]
    [InlineData("Unclosed {Name", "Unclosed {Name")]
    public void Renders_tokens(string template, string expected)
    {
        using var properties = JsonDocument.Parse("""{"Name":"World","Count":3,"Order":{"Id":7},"Nothing":null}""");
        var lookup = properties.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);

        Assert.Equal(expected, MessageTemplateRenderer.Render(template, lookup));
    }

    [Fact]
    public void Formatted_tokens_use_renderings_in_order()
    {
        using var properties = JsonDocument.Parse("""{"A":1.234,"B":"x","C":5}""");
        using var renderings = JsonDocument.Parse("""["1.2","005"]""");
        var lookup = properties.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value);

        var message = MessageTemplateRenderer.Render("{A:0.0} {B} {C:000}", lookup, renderings.RootElement);

        Assert.Equal("1.2 x 005", message);
    }
}
