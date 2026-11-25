using System.Globalization;
using System.Text.RegularExpressions;
using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Features.Events;

/// <summary>Compiles a bounded read-only grammar. SQL expressions come exclusively from fixed fragments.</summary>
public sealed partial class EventQueryLanguage
{
    private readonly string expression;
    private readonly EventFilter filter;
    private int offset;
    private int position;
    private int depth;
    private string token = "";
    private string tokenKind = "";

    private EventQueryLanguage(string expression, EventFilter filter)
    {
        this.expression = expression;
        this.filter = filter;
        Advance();
    }

    public sealed record Aggregate(string Value, string? Group);

    public static Aggregate? Compile(string? expression, EventFilter filter)
    {
        if (expression is { Length: > 4096 })
        {
            throw new FilterException("Query expressions can contain at most 4096 characters.");
        }

        var parser = new EventQueryLanguage(expression ?? "", filter);
        if (parser.Take("where"))
        {
            filter.Where(parser.Or());
        }

        var group = parser.Take("group") ? parser.Group() : null;
        Aggregate? aggregate = null;
        if (parser.Take("select"))
        {
            aggregate = new(parser.Aggregation(), group);
        }

        if (parser.tokenKind != "" || group is not null && aggregate is null)
        {
            throw parser.Error("Expected SELECT with an aggregate or the end of the query");
        }
        return aggregate;
    }

    private string Or()
    {
        var parts = new List<string> { And() };
        while (Take("or"))
        {
            parts.Add(And());
        }
        return $"({string.Join(" or ", parts)})";
    }

    private string And()
    {
        var parts = new List<string> { Predicate() };
        while (Take("and"))
        {
            parts.Add(Predicate());
        }
        return $"({string.Join(" and ", parts)})";
    }

    private string Predicate()
    {
        if (++depth > 16)
        {
            throw Error("Too many nested expressions");
        }

        string result;
        if (Take("not"))
        {
            result = $"not ({Predicate()})";
        }
        else if (Take("("))
        {
            result = Or();
            Require(")");
        }
        else
        {
            result = Comparison();
        }
        depth--;
        return result;
    }

    private string Comparison()
    {
        var field = ReadField();
        if (Take("contains"))
        {
            var text = ReadString();
            if (field.Kind is not ("text" or "json") || text.Length == 0)
            {
                throw Error("CONTAINS needs a text field and a non-empty string");
            }
            var pattern = filter.Parameter($"%{EventFilter.EscapeLike(text)}%");
            return $"({Text(field)} ilike {pattern})";
        }

        var op = token switch
        {
            "=" or "<" or ">" or "<=" or ">=" => token,
            "!=" => "<>",
            _ => throw Error("Expected a comparison operator"),
        };
        Advance();

        if (Take("null"))
        {
            if (op is not ("=" or "<>"))
            {
                throw Error("NULL supports = and !=");
            }
            var sql = field.Kind == "json" ? $"nullif({field.Sql}, 'null'::jsonb)" : field.Sql;
            return $"({sql} is {(op == "=" ? "" : "not ")}null)";
        }

        object value;
        var left = field.Sql;
        if (field.Kind == "level")
        {
            value = LogLevels.TryRank(ReadString()) ?? throw Error("Unknown log level");
        }
        else if (field.Kind == "text")
        {
            value = ReadString();
        }
        else if (field.Kind == "number" || field.Kind == "json" && tokenKind == "number")
        {
            if (tokenKind != "number" || !decimal.TryParse(token, NumberStyles.AllowDecimalPoint | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var number))
            {
                throw Error("Expected a supported number");
            }
            value = number;
            left = Numeric(field);
            Advance();
        }
        else if (tokenKind == "string")
        {
            value = ReadString();
            left = Text(field);
        }
        else if ((op is "=" or "<>") && (token.Equals("true", StringComparison.OrdinalIgnoreCase)
            || token.Equals("false", StringComparison.OrdinalIgnoreCase)))
        {
            value = token.Equals("true", StringComparison.OrdinalIgnoreCase);
            left = $"case when jsonb_typeof({field.Sql}) = 'boolean' then ({field.Sql} #>> '{{}}')::boolean end";
            Advance();
        }
        else
        {
            throw Error("Expected a string, number, boolean or NULL");
        }
        return $"({left} {op} {filter.Parameter(value)})";
    }

    private string Group()
    {
        Require("by");
        if (Take("bucket"))
        {
            Require("(");
            var width = ReadString() switch
            {
                "1m" => "1 minute",
                "5m" => "5 minutes",
                "1h" => "1 hour",
                "1d" => "1 day",
                _ => throw Error("Bucket must be '1m', '5m', '1h' or '1d'"),
            };
            Require(")");
            return $"date_bin({filter.Parameter(width)}::interval, timestamp, timestamptz '2000-01-01 UTC')";
        }

        var field = ReadField();
        return field.Kind == "level" ? "level" : field.Sql;
    }

    private string Aggregation()
    {
        var function = token.ToLowerInvariant();
        if (function is not ("count" or "min" or "max" or "avg" or "sum"))
        {
            throw Error("Expected count, min, max, avg or sum");
        }
        Advance();
        Require("(");
        if (function == "count")
        {
            Require(")");
            return "count(*)";
        }
        var field = ReadField();
        if (field.Kind is not ("number" or "json"))
        {
            throw Error("This aggregate requires a numeric field");
        }
        Require(")");
        return $"{function}({Numeric(field)})";
    }

    private Field ReadField()
    {
        if (tokenKind != "field")
        {
            throw Error("Expected a field name");
        }

        var name = token;
        var field = name.ToLowerInvariant() switch
        {
            "level" => new Field("level_rank", "level"),
            "message" => new Field("message", "text"),
            "exception" => new Field("exception", "text"),
            "traceid" => new Field("trace_id", "text"),
            "eventtype" => new Field("event_type", "number"),
            "apikeyid" => new Field("api_key_id", "number"),
            _ when name.StartsWith("properties.", StringComparison.OrdinalIgnoreCase) =>
                new Field($"(properties #> {filter.Parameter(name.Split('.')[1..])}::text[])", "json"),
            _ => throw Error("Unknown field"),
        };
        Advance();
        return field;
    }

    private static string Numeric(Field field) => field.Kind == "json"
        ? $"case when jsonb_typeof({field.Sql}) = 'number' then ({field.Sql} #>> '{{}}')::numeric end"
        : field.Sql;

    private static string Text(Field field) => field.Kind == "json"
        ? $"case when jsonb_typeof({field.Sql}) = 'string' then {field.Sql} #>> '{{}}' end"
        : field.Sql;

    private string ReadString()
    {
        if (tokenKind != "string")
        {
            throw Error("Expected a single-quoted string");
        }
        var value = token[1..^1].Replace("''", "'", StringComparison.Ordinal);
        Advance();
        return value;
    }

    private bool Take(string expected)
    {
        if (!token.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        Advance();
        return true;
    }

    private void Require(string expected)
    {
        if (!Take(expected))
        {
            throw Error($"Expected {expected}");
        }
    }

    private void Advance()
    {
        while (offset < expression.Length && char.IsWhiteSpace(expression[offset]))
        {
            offset++;
        }
        position = offset;
        if (offset == expression.Length)
        {
            token = tokenKind = "";
            return;
        }

        var match = Tokens().Match(expression, offset);
        if (!match.Success)
        {
            throw Error("Unexpected character");
        }
        token = match.Value;
        tokenKind = match.Groups["field"].Success ? "field" : match.Groups["number"].Success ? "number"
            : match.Groups["string"].Success ? "string" : "operator";
        offset += match.Length;
    }

    private FilterException Error(string message) => new($"{message} at position {position + 1}.");

    [GeneratedRegex("""\G(?:(?<field>[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)|(?<number>-?[0-9]+(?:\.[0-9]+)?)|(?<string>'(?:''|[^'\x00])*')|<=|>=|!=|[=<>(),])""")]
    private static partial Regex Tokens();

    private sealed record Field(string Sql, string Kind);
}
