using System.Text;
using System.Text.Json;

namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// Renders a message template ("User {UserId} logged in") with the event properties.
/// Supports {Name}, {@Name}, {$Name}, {Name:format}, {Name,alignment} and {{ }} escapes.
/// Tokens with a format use the matching entry of the CLEF @r renderings, in order.
/// String values are rendered without quotes; unknown properties keep the token text.
/// </summary>
public static class MessageTemplateRenderer
{
    public static string Render(string template, IReadOnlyDictionary<string, JsonElement> properties, JsonElement? renderings = null)
    {
        var output = new StringBuilder(template.Length + 32);
        var formattedTokenIndex = 0;

        for (var i = 0; i < template.Length; i++)
        {
            var c = template[i];

            if (c == '{' && i + 1 < template.Length && template[i + 1] == '{')
            {
                output.Append('{');
                i++;
                continue;
            }

            if (c == '}' && i + 1 < template.Length && template[i + 1] == '}')
            {
                output.Append('}');
                i++;
                continue;
            }

            if (c != '{')
            {
                output.Append(c);
                continue;
            }

            var end = template.IndexOf('}', i + 1);
            if (end < 0)
            {
                output.Append(template, i, template.Length - i);
                break;
            }

            var token = template.AsSpan(i + 1, end - i - 1);
            AppendToken(output, token, properties, renderings, ref formattedTokenIndex);
            i = end;
        }

        return output.ToString();
    }

    private static void AppendToken(
        StringBuilder output,
        ReadOnlySpan<char> token,
        IReadOnlyDictionary<string, JsonElement> properties,
        JsonElement? renderings,
        ref int formattedTokenIndex)
    {
        var name = token;
        if (name.Length > 0 && (name[0] == '@' || name[0] == '$'))
        {
            name = name[1..];
        }

        var separator = name.IndexOfAny(',', ':');
        var hasFormat = name.IndexOf(':') >= 0;
        if (separator >= 0)
        {
            name = name[..separator];
        }

        string? rendering = null;
        if (hasFormat)
        {
            rendering = RenderingAt(renderings, formattedTokenIndex);
            formattedTokenIndex++;
        }

        if (rendering is not null)
        {
            output.Append(rendering);
        }
        else if (properties.TryGetValue(name.ToString(), out var value))
        {
            output.Append(RenderValue(value));
        }
        else
        {
            output.Append('{').Append(token).Append('}');
        }
    }

    private static string? RenderingAt(JsonElement? renderings, int index) =>
        renderings is { ValueKind: JsonValueKind.Array } array
        && index < array.GetArrayLength()
        && array[index].ValueKind == JsonValueKind.String
            ? array[index].GetString()
            : null;

    private static string RenderValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Null => "null",
        _ => value.GetRawText(),
    };
}
