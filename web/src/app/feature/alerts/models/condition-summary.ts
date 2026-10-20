import { FilterSpec } from '../../../shared/models/filter-spec';

/** "0 min", "10 min", "1 h", "1 h 30 min", "1 day", "2 days 3 h". */
export function formatMinutes(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} h`);
  if (rest || !parts.length) parts.push(`${rest} min`);
  return parts.join(' ');
}

/** How often an alert may notify: "after every check" or "at most once per 1 h". */
export function formatSuppression(minutes: number): string {
  return minutes <= 0 ? 'after every check' : `at most once per ${formatMinutes(minutes)}`;
}

export interface ConditionInput {
  threshold: number;
  windowMinutes: number;
  filter: FilterSpec | null;
}

export interface ConditionNames {
  /** Title of the alert's signal, when it has one. */
  signal?: string | null;
  /** Title of an API key by id. */
  apiKey?: (id: number) => string | undefined;
}

/** Filter parts in reading order: signal, levels, text, exception, properties, keys, trace, type. */
export function filterParts(filter: FilterSpec | null, names: ConditionNames = {}): string[] {
  const parts: string[] = [];
  if (names.signal) parts.push(names.signal);
  const levels = filter?.levels ?? [];
  if (levels.length) parts.push(`level ${levels.join('/')}`);
  if (filter?.text) parts.push(`text "${filter.text}"`);
  if (filter?.hasException) parts.push('with exception');
  for (const property of filter?.properties ?? []) parts.push(property);
  const keys = filter?.apiKeyIds ?? [];
  if (keys.length) {
    const titles = keys.map((id) => names.apiKey?.(id) ?? `#${id}`);
    parts.push(`${keys.length === 1 ? 'API key' : 'API keys'} ${titles.join(', ')}`);
  }
  if (filter?.traceId) parts.push(`trace ${filter.traceId}`);
  if (filter?.eventType) parts.push(`type ${filter.eventType}`);
  return parts;
}

/** One-line condition: "≥ 5 events in 10 min, matching Errors, text "timeout"". */
export function conditionSummary(condition: ConditionInput, names: ConditionNames = {}): string {
  const count = `≥ ${condition.threshold} ${condition.threshold === 1 ? 'event' : 'events'}`;
  const head = `${count} in ${formatMinutes(condition.windowMinutes)}`;
  const parts = filterParts(condition.filter, names);
  return parts.length ? `${head}, matching ${parts.join(', ')}` : `${head} (any event)`;
}
