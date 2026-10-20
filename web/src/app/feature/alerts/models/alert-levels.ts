/** Event levels in rank order (docs/api/v1.md, Events). */
export const ALERT_LEVELS = [
  'Verbose',
  'Debug',
  'Information',
  'Warning',
  'Error',
  'Fatal',
] as const;

export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Dot color per level. Full class strings so Tailwind can see them. */
export const ALERT_LEVEL_DOT: Record<AlertLevel, string> = {
  Verbose: 'bg-zinc-300 dark:bg-zinc-600',
  Debug: 'bg-zinc-400 dark:bg-zinc-500',
  Information: 'bg-sky-500 dark:bg-sky-400',
  Warning: 'bg-amber-500 dark:bg-amber-400',
  Error: 'bg-red-500 dark:bg-red-400',
  Fatal: 'bg-fuchsia-700 dark:bg-fuchsia-500',
};

/** Known levels from `values`, in rank order, without duplicates (case-insensitive). */
export function normalizeLevels(values: readonly string[] | null | undefined): AlertLevel[] {
  const wanted = new Set((values ?? []).map((value) => value.trim().toLowerCase()));
  return ALERT_LEVELS.filter((level) => wanted.has(level.toLowerCase()));
}
