import { LogEvent } from '../models/log-event';

/** Upper bound of events kept in memory while live mode prepends new ones. */
export const MAX_BUFFERED_EVENTS = 5000;

export interface BufferUpdate {
  events: LogEvent[];
  /** True when the oldest events had to be dropped to respect the cap. */
  trimmed: boolean;
}

/**
 * Puts `incoming` (newest first) on top of `existing`, skipping ids already present,
 * and drops the oldest events beyond `cap`.
 */
export function prependEvents(
  existing: readonly LogEvent[],
  incoming: readonly LogEvent[],
  cap = MAX_BUFFERED_EVENTS,
): BufferUpdate {
  const seen = new Set(existing.map((event) => event.id));
  const fresh: LogEvent[] = [];
  for (const event of incoming) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  const merged = fresh.length ? [...fresh, ...existing] : [...existing];
  return merged.length > cap
    ? { events: merged.slice(0, cap), trimmed: true }
    : { events: merged, trimmed: false };
}

/** Appends an older page, skipping events already shown (live and paged results can overlap). */
export function appendEvents(
  existing: readonly LogEvent[],
  older: readonly LogEvent[],
): LogEvent[] {
  const seen = new Set(existing.map((event) => event.id));
  return [...existing, ...older.filter((event) => !seen.has(event.id))];
}
