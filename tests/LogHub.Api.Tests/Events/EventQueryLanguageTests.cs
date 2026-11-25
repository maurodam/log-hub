using LogHub.Api.Features.Events;

namespace LogHub.Api.Tests.Events;

public class EventQueryLanguageTests
{
    [Fact]
    public void Compiles_typed_nested_filters_and_aggregation_with_parameters()
    {
        var filter = new EventFilter();
        var aggregate = EventQueryLanguage.Compile(
            "WHERE (properties.http.status >= 500 OR exception CONTAINS 'x_%') AND NOT properties.isTest = TRUE GROUP BY properties.App SELECT count()",
            filter);
        Assert.NotNull(aggregate);
        Assert.Contains("properties #>", aggregate.Group);
        Assert.Equal("count(*)", aggregate.Value);
        Assert.Contains("jsonb_typeof", filter.WhereClause());
        Assert.DoesNotContain("status", filter.WhereClause());
        Assert.Equal(500m, filter.Parameters.Get<decimal>("p1"));
        Assert.Equal("%x\\_\\%%", filter.Parameters.Get<string>("p2"));
        Assert.True(filter.Parameters.Get<bool>("p4"));
    }

    [Theory]
    [InlineData("WHERE level = 4")]
    [InlineData("WHERE message = 'ok'; SELECT count()")]
    [InlineData("SELECT sum(message)")]
    [InlineData("GROUP BY bucket('3d') SELECT count()")]
    [InlineData("WHERE noSuchField = 'test'")]
    public void Rejects_invalid_expressions_with_a_position(string query)
    {
        var error = Assert.Throws<FilterException>(() => EventQueryLanguage.Compile(query, new EventFilter()));
        Assert.Contains("position", error.Message);
    }
}
