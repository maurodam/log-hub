using LogHub.Api.Features.Ingestion;

namespace LogHub.Api.Tests.Ingestion;

public class LogLevelsTests
{
    [Theory]
    [InlineData("Verbose", LogLevels.Verbose)]
    [InlineData("trace", LogLevels.Verbose)]
    [InlineData("DEBUG", LogLevels.Debug)]
    [InlineData("dbg", LogLevels.Debug)]
    [InlineData("Information", LogLevels.Information)]
    [InlineData("info", LogLevels.Information)]
    [InlineData("warn", LogLevels.Warning)]
    [InlineData("WRN", LogLevels.Warning)]
    [InlineData("Error", LogLevels.Error)]
    [InlineData("err", LogLevels.Error)]
    [InlineData("fatal", LogLevels.Fatal)]
    [InlineData("Critical", LogLevels.Fatal)]
    [InlineData("panic", LogLevels.Fatal)]
    [InlineData(" warning ", LogLevels.Warning)]
    public void Maps_level_aliases_to_ranks(string level, short expected) =>
        Assert.Equal(expected, LogLevels.Rank(level));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("custom")]
    public void Unknown_or_missing_levels_count_as_information(string? level)
    {
        Assert.Equal(LogLevels.Information, LogLevels.Rank(level));
        Assert.Null(LogLevels.TryRank(level));
    }

    [Fact]
    public void Names_follow_serilog() =>
        Assert.Equal("Warning", LogLevels.Name(LogLevels.Warning));
}
