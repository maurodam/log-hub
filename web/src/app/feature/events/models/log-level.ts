/** Canonical levels, ordered by rank (index = levelRank). */
export const LOG_LEVELS = ['Verbose', 'Debug', 'Information', 'Warning', 'Error', 'Fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LevelStyle {
  /** Three-letter code shown in dense rows. */
  short: string;
  /** Small solid indicator (dots). */
  dot: string;
  /** Tinted pill with readable text in light and dark themes. */
  badge: string;
  /** Subtle row background for the louder levels. */
  row: string;
}

// Full class strings so the Tailwind scanner can see them.
export const LEVEL_STYLES: Record<LogLevel, LevelStyle> = {
  Verbose: {
    short: 'VRB',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
    badge: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
    row: '',
  },
  Debug: {
    short: 'DBG',
    dot: 'bg-zinc-400 dark:bg-zinc-500',
    badge: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
    row: '',
  },
  Information: {
    short: 'INF',
    dot: 'bg-sky-500 dark:bg-sky-400',
    badge: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    row: '',
  },
  Warning: {
    short: 'WRN',
    dot: 'bg-amber-500 dark:bg-amber-400',
    badge: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',
    row: 'bg-amber-500/[0.04] dark:bg-amber-400/[0.05]',
  },
  Error: {
    short: 'ERR',
    dot: 'bg-red-500 dark:bg-red-400',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300',
    row: 'bg-red-500/[0.05] dark:bg-red-400/[0.07]',
  },
  Fatal: {
    short: 'FTL',
    dot: 'bg-fuchsia-700 dark:bg-fuchsia-500',
    badge: 'bg-fuchsia-700 text-white dark:bg-fuchsia-600',
    row: 'bg-fuchsia-600/[0.07] dark:bg-fuchsia-500/[0.1]',
  },
};

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Maps a server `levelRank` to its canonical level; out-of-range values are clamped. */
export function levelFromRank(rank: number): LogLevel {
  const index = Number.isFinite(rank) ? Math.round(rank) : 2;
  return LOG_LEVELS[Math.min(Math.max(index, 0), LOG_LEVELS.length - 1)];
}

/**
 * Parses a comma-separated level list (case-insensitive), dropping unknown names and duplicates.
 * Result is in rank order so equal selections always serialize the same way.
 */
export function parseLevels(value: string | null | undefined): LogLevel[] {
  if (!value) return [];
  const wanted = new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  return LOG_LEVELS.filter((level) => wanted.has(level.toLowerCase()));
}

/** Normalizes a selection: rank order, no duplicates; "every level" collapses to empty (= all). */
export function normalizeLevels(levels: readonly LogLevel[]): LogLevel[] {
  const selected = LOG_LEVELS.filter((level) => levels.includes(level));
  return selected.length === LOG_LEVELS.length ? [] : selected;
}
