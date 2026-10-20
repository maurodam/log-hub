import { LogLevel, normalizeLevels, parseLevels } from './log-level';
import {
  formatPropertyFilter,
  parsePropertyFilter,
  PropertyFilter,
  samePropertyFilter,
} from './property-filter';

export interface TimeRangeOption {
  id: string;
  label: string;
  title: string;
  /** Window length in milliseconds; null = unbounded. */
  durationMs: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const TIME_RANGES = [
  { id: '15m', label: '15m', title: 'Last 15 minutes', durationMs: 15 * MINUTE },
  { id: '1h', label: '1h', title: 'Last hour', durationMs: HOUR },
  { id: '6h', label: '6h', title: 'Last 6 hours', durationMs: 6 * HOUR },
  { id: '24h', label: '24h', title: 'Last 24 hours', durationMs: DAY },
  { id: '7d', label: '7d', title: 'Last 7 days', durationMs: 7 * DAY },
  { id: '30d', label: '30d', title: 'Last 30 days', durationMs: 30 * DAY },
  { id: 'all', label: 'All', title: 'All time', durationMs: null },
] as const satisfies readonly TimeRangeOption[];

export type TimeRange = (typeof TIME_RANGES)[number]['id'];

export interface EventFilter {
  text: string;
  /** Selected levels in rank order; empty = all levels. */
  levels: readonly LogLevel[];
  /** Relative window. Ignored when an absolute bound (`from` / `to`) is set. */
  range: TimeRange;
  /** Absolute bounds as ISO 8601 ('' = unbounded), e.g. a bucket opened from the dashboard. */
  from: string;
  to: string;
  traceId: string;
  /** Exact event type (`$A1B2C3D4`). */
  eventType: string;
  properties: readonly PropertyFilter[];
  /** Ids of the API keys the events were ingested with (any of them); sorted. */
  apiKeys: readonly number[];
  /** Only events with an exception. */
  hasException: boolean;
  /** Selected signal ids, sorted. The server combines them (same group = OR, else AND). */
  signals: readonly number[];
}

export const DEFAULT_FILTER: EventFilter = {
  text: '',
  levels: [],
  range: 'all',
  from: '',
  to: '',
  traceId: '',
  eventType: '',
  properties: [],
  apiKeys: [],
  hasException: false,
  signals: [],
};

/** Query string values: a missing key means "not set". */
export type QueryValues = Record<string, string | string[]>;

/** Minimal read API shared by Angular's `ParamMap` and `URLSearchParams`. */
export interface QueryParamSource {
  get(name: string): string | null;
  getAll(name: string): string[];
}

export function isTimeRange(value: unknown): value is TimeRange {
  return TIME_RANGES.some((range) => range.id === value);
}

/** Start of the time window for `range`, or null when unbounded. */
export function rangeStart(range: TimeRange, now: Date): Date | null {
  const option = TIME_RANGES.find((r) => r.id === range);
  return option?.durationMs ? new Date(now.getTime() - option.durationMs) : null;
}

/** True when the filter uses absolute bounds instead of a relative range. */
export function hasCustomRange(filter: Pick<EventFilter, 'from' | 'to'>): boolean {
  return !!(filter.from || filter.to);
}

/** Parses a comma-separated list of positive integer ids: unique, ascending, junk dropped. */
export function parseIdList(value: string | null | undefined): number[] {
  if (!value) return [];
  const ids = new Set<number>();
  for (const part of value.split(',')) {
    const text = part.trim();
    if (!/^\d+$/.test(text)) continue;
    const id = Number(text);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** Normalizes an id selection the same way `parseIdList` does. */
export function normalizeIds(ids: readonly number[]): number[] {
  return parseIdList(ids.join(','));
}

/** Parses an ISO 8601 date into its canonical `toISOString()` form; '' when invalid or empty. */
export function parseIsoDate(value: string | null | undefined): string {
  if (!value?.trim()) return '';
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseBoolean(value: string | null): boolean {
  return value === 'true' || value === '1';
}

/**
 * Reads a filter from the page URL: `text`, `levels`, `range` or `from`/`to`, `traceId`,
 * `eventType`, repeated `property`, `apiKeys`, `hasException`, `signals`.
 */
export function filterFromQueryParams(params: QueryParamSource): EventFilter {
  const properties: PropertyFilter[] = [];
  for (const raw of params.getAll('property')) {
    const parsed = parsePropertyFilter(raw);
    if (parsed && !properties.some((p) => samePropertyFilter(p, parsed))) properties.push(parsed);
  }
  const from = parseIsoDate(params.get('from'));
  const to = parseIsoDate(params.get('to'));
  const range = params.get('range');
  return {
    text: params.get('text')?.trim() ?? '',
    levels: normalizeLevels(parseLevels(params.get('levels'))),
    range: !from && !to && isTimeRange(range) ? range : DEFAULT_FILTER.range,
    from,
    to,
    traceId: params.get('traceId')?.trim() ?? '',
    eventType: params.get('eventType')?.trim() ?? '',
    properties,
    apiKeys: parseIdList(params.get('apiKeys')),
    hasException: parseBoolean(params.get('hasException')),
    signals: parseIdList(params.get('signals')),
  };
}

/** Inverse of `filterFromQueryParams`; default values are left out to keep URLs short. */
export function filterToQueryParams(filter: EventFilter): QueryValues {
  const params = streamQuery(filter);
  if (hasCustomRange(filter)) {
    if (filter.from) params['from'] = filter.from;
    if (filter.to) params['to'] = filter.to;
  } else if (filter.range !== DEFAULT_FILTER.range) {
    params['range'] = filter.range;
  }
  return params;
}

/** Parameters for `GET /api/v1/events/stream` (everything except the time range). */
export function streamQuery(filter: EventFilter): QueryValues {
  const query: QueryValues = {};
  if (filter.text) query['text'] = filter.text;
  const levels = normalizeLevels(filter.levels);
  if (levels.length) query['levels'] = levels.join(',');
  if (filter.traceId) query['traceId'] = filter.traceId;
  if (filter.eventType) query['eventType'] = filter.eventType;
  if (filter.properties.length) query['property'] = filter.properties.map(formatPropertyFilter);
  const apiKeys = normalizeIds(filter.apiKeys);
  if (apiKeys.length) query['apiKeys'] = apiKeys.join(',');
  if (filter.hasException) query['hasException'] = 'true';
  const signals = normalizeIds(filter.signals);
  if (signals.length) query['signals'] = signals.join(',');
  return query;
}

/** Parameters for `GET /api/v1/events`; a relative time range is resolved against `now`. */
export function listQuery(filter: EventFilter, now: Date): QueryValues {
  const query = streamQuery(filter);
  if (hasCustomRange(filter)) {
    if (filter.from) query['from'] = filter.from;
    if (filter.to) query['to'] = filter.to;
    return query;
  }
  const from = rangeStart(filter.range, now);
  if (from) query['from'] = from.toISOString();
  return query;
}

export function sameFilter(a: EventFilter, b: EventFilter): boolean {
  return JSON.stringify(filterToQueryParams(a)) === JSON.stringify(filterToQueryParams(b));
}

export function hasActiveFilters(filter: EventFilter): boolean {
  return !sameFilter(filter, DEFAULT_FILTER);
}
