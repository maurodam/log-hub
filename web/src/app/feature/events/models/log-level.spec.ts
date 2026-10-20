import {
  isLogLevel,
  LEVEL_STYLES,
  levelFromRank,
  LOG_LEVELS,
  normalizeLevels,
  parseLevels,
} from './log-level';

describe('log level helpers', () => {
  it('maps ranks to canonical levels and clamps out-of-range values', () => {
    expect(LOG_LEVELS.map((_, rank) => levelFromRank(rank))).toEqual([...LOG_LEVELS]);
    expect(levelFromRank(-3)).toBe('Verbose');
    expect(levelFromRank(9)).toBe('Fatal');
    expect(levelFromRank(Number.NaN)).toBe('Information');
  });

  it('recognises only canonical names', () => {
    expect(isLogLevel('Warning')).toBe(true);
    expect(isLogLevel('warn')).toBe(false);
  });

  it('parses comma-separated lists case-insensitively, in rank order', () => {
    expect(parseLevels('fatal, warning,Bogus,,WARNING')).toEqual(['Warning', 'Fatal']);
    expect(parseLevels(null)).toEqual([]);
  });

  it('normalizes selections and collapses "all" to empty', () => {
    expect(normalizeLevels(['Error', 'Debug', 'Error'])).toEqual(['Debug', 'Error']);
    expect(normalizeLevels([...LOG_LEVELS])).toEqual([]);
  });

  it('has a style for every level', () => {
    for (const level of LOG_LEVELS) expect(LEVEL_STYLES[level].short).toHaveLength(3);
  });
});
