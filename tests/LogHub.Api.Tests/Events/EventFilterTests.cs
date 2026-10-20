using Dapper;
using LogHub.Api.Features.Auth;
using LogHub.Api.Features.Events;

namespace LogHub.Api.Tests.Events;

public class EventFilterTests
{
    [Fact]
    public void Empty_spec_adds_no_condition()
    {
        var filter = new EventFilter().AddSpec(new FilterSpec());

        Assert.Equal(string.Empty, filter.WhereClause());
    }

    [Fact]
    public void Spec_conditions_are_parameterized_and_combined_with_and()
    {
        var filter = new EventFilter().AddSpec(new FilterSpec(Text: "50%_off", Levels: ["warn", "Error"], HasException: true));

        var where = filter.WhereClause();

        Assert.Equal(""" where ((message ilike @p0 or exception ilike @p0) and level_rank = any(@p1) and exception is not null)""", where);
        Assert.Equal(@"%50\%\_off%", filter.Parameters.Get<string>("p0"));
        Assert.Equal(new short[] { 3, 4 }, filter.Parameters.Get<short[]>("p1"));
    }

    [Theory]
    [InlineData("Count=42", """{"Count":42}""")]
    [InlineData("Ok=true", """{"Ok":true}""")]
    [InlineData("Name=Billing", """{"Name":"Billing"}""")]
    [InlineData("Code=\"42\"", """{"Code":"42"}""")]
    [InlineData("Path=a=b", """{"Path":"a=b"}""")]
    public void Property_values_keep_json_literal_types(string property, string expected)
    {
        var filter = new EventFilter().AddSpec(new FilterSpec(Properties: [property]));

        Assert.Equal(expected, filter.Parameters.Get<string>("p0"));
    }

    [Fact]
    public void Signals_in_one_group_use_or_and_groups_use_and()
    {
        var filter = new EventFilter().AddSignals([
            new SignalDefinition(1, "Level", new FilterSpec(Levels: ["Error"])),
            new SignalDefinition(2, "Level", new FilterSpec(Levels: ["Warning"])),
            new SignalDefinition(3, null, new FilterSpec(HasException: true)),
        ]);

        Assert.Equal(""" where (level_rank = any(@p0) or level_rank = any(@p1)) and exception is not null""", filter.WhereClause());
    }

    [Theory]
    [InlineData("levels", "Loud")]
    [InlineData("property", "NoEquals")]
    [InlineData("eventType", "not-hex")]
    public void Invalid_input_throws_filter_exception(string field, string value)
    {
        var spec = field switch
        {
            "levels" => new FilterSpec(Levels: [value]),
            "property" => new FilterSpec(Properties: [value]),
            _ => new FilterSpec(EventType: value),
        };

        Assert.Throws<FilterException>(() => new EventFilter().AddSpec(spec));
    }

    [Theory]
    [InlineData("/events?levels=Error", "/events?levels=Error")]
    [InlineData("https://evil.example", "/")]
    [InlineData("//evil.example", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData(null, "/")]
    public void Return_urls_stay_local(string? returnUrl, string expected) =>
        Assert.Equal(expected, AuthEndpoints.SafeReturnUrl(returnUrl));
}
