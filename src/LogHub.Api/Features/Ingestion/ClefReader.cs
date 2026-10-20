using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// Parses an ingestion payload into events. Accepted formats:
/// newline-delimited CLEF (application/vnd.serilog.clef), a single CLEF object,
/// and the legacy batch format {"Events":[{ "Timestamp", "Level", "MessageTemplate", "Properties", ... }]}.
/// Any invalid event rejects the whole payload with <see cref="InvalidPayloadException"/>.
/// </summary>
public static class ClefReader
{
    public static List<IngestedEvent> Read(ReadOnlyMemory<byte> payload, bool isClef, int maxEventBytes, JsonElement? appliedProperties = null)
    {
        payload = SkipUtf8Bom(payload);
        var events = new List<IngestedEvent>();

        if (!isClef && TryParseDocument(payload, out var document))
        {
            using (document)
            {
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("Events", out var legacyEvents)
                    && legacyEvents.ValueKind == JsonValueKind.Array)
                {
                    var index = 0;
                    foreach (var item in legacyEvents.EnumerateArray())
                    {
                        events.Add(FromLegacy(item, $"event {++index}", appliedProperties));
                    }
                }
                else
                {
                    if (payload.Length > maxEventBytes)
                    {
                        throw new InvalidPayloadException($"The event is larger than {maxEventBytes} bytes.");
                    }

                    events.Add(FromClef(root, "event 1", appliedProperties));
                }
            }

            return events;
        }

        var remaining = payload;
        var lineNumber = 0;
        while (!remaining.IsEmpty)
        {
            lineNumber++;
            var newline = remaining.Span.IndexOf((byte)'\n');
            var line = newline >= 0 ? remaining[..newline] : remaining;
            remaining = newline >= 0 ? remaining[(newline + 1)..] : ReadOnlyMemory<byte>.Empty;

            line = line.Trim(" \t\r"u8);
            if (line.IsEmpty)
            {
                continue;
            }

            if (line.Length > maxEventBytes)
            {
                throw new InvalidPayloadException($"The event on line {lineNumber} is larger than {maxEventBytes} bytes.");
            }

            JsonDocument lineDocument;
            try
            {
                lineDocument = JsonDocument.Parse(line);
            }
            catch (JsonException ex)
            {
                throw new InvalidPayloadException($"Line {lineNumber} is not valid JSON: {ex.Message}");
            }

            using (lineDocument)
            {
                events.Add(FromClef(lineDocument.RootElement, $"line {lineNumber}", appliedProperties));
            }
        }

        return events;
    }

    private static IngestedEvent FromClef(JsonElement source, string position, JsonElement? appliedProperties)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidPayloadException($"The event on {position} is not a JSON object.");
        }

        DateTimeOffset? timestamp = null;
        DateTimeOffset? spanStart = null;
        string? template = null, message = null, level = null, exception = null;
        string? traceId = null, spanId = null, parentSpanId = null, spanKind = null;
        string? resource = null, scope = null;
        long? eventType = null;
        JsonElement? renderings = null;
        var properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);

        foreach (var property in source.EnumerateObject())
        {
            switch (property.Name)
            {
                case "@t": timestamp = ReadTimestamp(property.Value, position, "@t"); break;
                case "@mt": template = AsString(property.Value); break;
                case "@m": message = AsString(property.Value); break;
                case "@l": level = AsString(property.Value); break;
                case "@x": exception = AsString(property.Value); break;
                case "@i": eventType = ReadEventType(property.Value); break;
                case "@r": renderings = property.Value; break;
                case "@tr": traceId = AsString(property.Value); break;
                case "@sp": spanId = AsString(property.Value); break;
                case "@ps": parentSpanId = AsString(property.Value); break;
                case "@sk": spanKind = AsString(property.Value); break;
                case "@st": spanStart = ReadTimestamp(property.Value, position, "@st"); break;
                case "@ra": resource = property.Value.GetRawText(); break;
                case "@sa": scope = property.Value.GetRawText(); break;
                default:
                    // "@@name" escapes a user property called "@name"; unknown "@" keys stay as properties.
                    var name = property.Name.StartsWith("@@", StringComparison.Ordinal) ? property.Name[1..] : property.Name;
                    properties[name] = property.Value;
                    break;
            }
        }

        if (timestamp is null)
        {
            throw new InvalidPayloadException($"The event on {position} has no @t timestamp.");
        }

        return Build(timestamp.Value, level, template, message, exception, eventType,
            traceId, spanId, parentSpanId, spanKind, spanStart, properties, renderings, resource, scope, appliedProperties);
    }

    private static IngestedEvent FromLegacy(JsonElement source, string position, JsonElement? appliedProperties)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidPayloadException($"The {position} is not a JSON object.");
        }

        if (!source.TryGetProperty("Timestamp", out var timestampValue))
        {
            throw new InvalidPayloadException($"The {position} has no Timestamp.");
        }

        var properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (source.TryGetProperty("Properties", out var propertiesValue) && propertiesValue.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in propertiesValue.EnumerateObject())
            {
                properties[property.Name] = property.Value;
            }
        }

        string? Text(string name) => source.TryGetProperty(name, out var value) ? AsString(value) : null;

        return Build(
            ReadTimestamp(timestampValue, position, "Timestamp"),
            Text("Level"),
            Text("MessageTemplate"),
            message: null,
            Text("Exception"),
            source.TryGetProperty("EventType", out var eventTypeValue) ? ReadEventType(eventTypeValue) : null,
            Text("TraceId"),
            Text("SpanId"),
            parentSpanId: null,
            spanKind: null,
            spanStart: null,
            properties,
            source.TryGetProperty("Renderings", out var renderingsValue) ? renderingsValue : null,
            resource: null,
            scope: null,
            appliedProperties);
    }

    private static IngestedEvent Build(
        DateTimeOffset timestamp, string? level, string? template, string? message, string? exception, long? eventType,
        string? traceId, string? spanId, string? parentSpanId, string? spanKind, DateTimeOffset? spanStart,
        Dictionary<string, JsonElement> properties, JsonElement? renderings, string? resource, string? scope,
        JsonElement? appliedProperties)
    {
        // Legacy renderings are an object keyed by property name; only CLEF @r arrays drive token rendering.
        var tokenRenderings = renderings is { ValueKind: JsonValueKind.Array } ? renderings : null;
        message ??= template is null ? null : MessageTemplateRenderer.Render(template, properties, tokenRenderings);

        return new IngestedEvent(
            timestamp,
            level ?? LogLevels.Name(LogLevels.Information),
            LogLevels.Rank(level),
            template,
            message,
            exception,
            eventType ?? Hash(template ?? message ?? string.Empty),
            traceId,
            spanId,
            parentSpanId,
            spanKind,
            spanStart,
            WriteProperties(properties, appliedProperties),
            renderings?.GetRawText(),
            resource,
            scope);
    }

    /// <summary>Serializes the event properties; properties applied by the API key override the event's own.</summary>
    private static string WriteProperties(Dictionary<string, JsonElement> properties, JsonElement? appliedProperties)
    {
        var applied = appliedProperties is { ValueKind: JsonValueKind.Object } value ? value : (JsonElement?)null;
        var buffer = new ArrayBufferWriter<byte>();

        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            foreach (var (name, propertyValue) in properties)
            {
                if (applied is { } overrides && overrides.TryGetProperty(name, out _))
                {
                    continue;
                }

                writer.WritePropertyName(name);
                propertyValue.WriteTo(writer);
            }

            if (applied is { } appliedObject)
            {
                foreach (var property in appliedObject.EnumerateObject())
                {
                    property.WriteTo(writer);
                }
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static DateTimeOffset ReadTimestamp(JsonElement value, string position, string field)
    {
        if (value.ValueKind == JsonValueKind.String)
        {
            if (value.TryGetDateTimeOffset(out var timestamp))
            {
                return timestamp;
            }

            if (DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out timestamp))
            {
                return timestamp;
            }
        }

        throw new InvalidPayloadException($"The {field} value of the event on {position} is not a valid ISO 8601 timestamp.");
    }

    /// <summary>@i can be a number or a hex string; anything else is hashed.</summary>
    private static long ReadEventType(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number)
        {
            return value.TryGetUInt32(out var number) ? number : value.TryGetInt64(out var wide) ? wide : Hash(value.GetRawText());
        }

        var text = AsString(value) ?? string.Empty;
        var hex = text.TrimStart('$');
        if (hex.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            hex = hex[2..];
        }

        return uint.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var parsed) ? parsed : Hash(text);
    }

    /// <summary>32-bit FNV-1a hash of the UTF-8 text, used as event type when the client sends none.</summary>
    private static long Hash(string text)
    {
        var hash = 2166136261u;
        foreach (var b in Encoding.UTF8.GetBytes(text))
        {
            hash ^= b;
            hash *= 16777619u;
        }

        return hash;
    }

    private static string? AsString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Null => null,
        _ => value.GetRawText(),
    };

    private static bool TryParseDocument(ReadOnlyMemory<byte> payload, out JsonDocument document)
    {
        try
        {
            document = JsonDocument.Parse(payload);
            return true;
        }
        catch (JsonException)
        {
            document = null!;
            return false;
        }
    }

    private static ReadOnlyMemory<byte> SkipUtf8Bom(ReadOnlyMemory<byte> payload) =>
        payload.Span.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF]) ? payload[3..] : payload;
}
