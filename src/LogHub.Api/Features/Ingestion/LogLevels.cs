namespace LogHub.Api.Features.Ingestion;

/// <summary>
/// Maps free-text level names ("warn", "ERR", "critical"...) to a rank from 0 (Verbose) to 5 (Fatal).
/// Unknown or missing names count as Information.
/// </summary>
public static class LogLevels
{
    public const short Verbose = 0;
    public const short Debug = 1;
    public const short Information = 2;
    public const short Warning = 3;
    public const short Error = 4;
    public const short Fatal = 5;

    private static readonly string[] Names = ["Verbose", "Debug", "Information", "Warning", "Error", "Fatal"];

    private static readonly Dictionary<string, short> Aliases = BuildAliases();

    public static short Rank(string? level) => TryRank(level) ?? Information;

    public static short? TryRank(string? level) =>
        level is not null && Aliases.TryGetValue(level.Trim(), out var rank) ? rank : null;

    public static string Name(short rank) => Names[rank];

    private static Dictionary<string, short> BuildAliases()
    {
        var aliases = new Dictionary<string, short>(StringComparer.OrdinalIgnoreCase);
        Add(Verbose, "verbose", "verb", "vrb", "v", "trace", "trc", "t");
        Add(Debug, "debug", "dbg", "deb", "d");
        Add(Information, "information", "info", "inf", "i", "notice");
        Add(Warning, "warning", "warn", "wrn", "war", "wa", "w");
        Add(Error, "error", "err", "eror", "erro", "er", "e");
        Add(Fatal, "fatal", "fata", "fatl", "fat", "fa", "ftl", "f",
            "critical", "crit", "crt", "cri", "cr", "c", "alert", "emerg", "emergency", "panic");
        return aliases;

        void Add(short rank, params string[] names)
        {
            foreach (var name in names)
            {
                aliases[name] = rank;
            }
        }
    }
}
