import {
  DEFAULT_FILTER,
  EventFilter,
  filterToQueryParams,
  normalizeIds,
  parseIdList,
  parseIsoDate,
  QueryParamSource,
  QueryValues,
  TIME_RANGES,
  TimeRangeOption,
} from '../../events/models/event-filter';

/** Presets offered by the dashboard: always a bounded window. */
export const DASHBOARD_RANGE_IDS = ['15m', '1h', '6h', '24h', '7d', '30d'] as const;
export type DashboardRange = (typeof DASHBOARD_RANGE_IDS)[number];

export const DASHBOARD_RANGES: readonly (TimeRangeOption & { id: DashboardRange })[] =
  DASHBOARD_RANGE_IDS.map((id) => {
    const option = TIME_RANGES.find((range) => range.id === id);
    if (!option?.durationMs) throw new Error(`Unknown dashboard range ${id}`);
    return { ...option, id };
  });

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '24h';

export interface DashboardFilter {
  range: DashboardRange;
  /** Custom window (ISO 8601). Used only when both are set; overrides `range`. */
  from: string;
  to: string;
  signals: readonly number[];
  apiKeys: readonly number[];
  text: string;
  /** Reload every 30 seconds. */
  autoRefresh: boolean;
}

export const DEFAULT_DASHBOARD_FILTER: DashboardFilter = {
  range: DEFAULT_DASHBOARD_RANGE,
  from: '',
  to: '',
  signals: [],
  apiKeys: [],
  text: '',
  autoRefresh: false,
};

export interface TimeWindow {
  from: Date;
  to: Date;
}

export function isDashboardRange(value: unknown): value is DashboardRange {
  return DASHBOARD_RANGE_IDS.some((id) => id === value);
}

export function isCustomWindow(filter: Pick<DashboardFilter, 'from' | 'to'>): boolean {
  return !!filter.from && !!filter.to;
}

/** Reads the dashboard state from the URL; an incomplete or reversed custom window is dropped. */
export function dashboardFilterFromParams(params: QueryParamSource): DashboardFilter {
  let from = parseIsoDate(params.get('from'));
  let to = parseIsoDate(params.get('to'));
  if (!from || !to || from >= to) from = to = '';
  const range = params.get('range');
  const auto = params.get('auto');
  return {
    range: isDashboardRange(range) ? range : DEFAULT_DASHBOARD_RANGE,
    from,
    to,
    signals: parseIdList(params.get('signals')),
    apiKeys: parseIdList(params.get('apiKeys')),
    text: params.get('text')?.trim() ?? '',
    autoRefresh: auto === 'true' || auto === '1',
  };
}

/** Inverse of `dashboardFilterFromParams`; defaults are left out. */
export function dashboardFilterToParams(filter: DashboardFilter): QueryValues {
  const params: QueryValues = {};
  if (isCustomWindow(filter)) {
    params['from'] = filter.from;
    params['to'] = filter.to;
  } else if (filter.range !== DEFAULT_DASHBOARD_RANGE) {
    params['range'] = filter.range;
  }
  const signals = normalizeIds(filter.signals);
  if (signals.length) params['signals'] = signals.join(',');
  const apiKeys = normalizeIds(filter.apiKeys);
  if (apiKeys.length) params['apiKeys'] = apiKeys.join(',');
  if (filter.text.trim()) params['text'] = filter.text.trim();
  if (filter.autoRefresh) params['auto'] = 'true';
  return params;
}

/** Absolute window of the filter: the custom one, or the preset ending at `now`. */
export function resolveWindow(filter: DashboardFilter, now: Date): TimeWindow {
  if (isCustomWindow(filter)) return { from: new Date(filter.from), to: new Date(filter.to) };
  const duration = DASHBOARD_RANGES.find((range) => range.id === filter.range)?.durationMs ?? 0;
  return { from: new Date(now.getTime() - duration), to: now };
}

/** Parameters for `GET /api/v1/stats/overview`. */
export function statsQuery(filter: DashboardFilter, window: TimeWindow): QueryValues {
  const query: QueryValues = { from: window.from.toISOString(), to: window.to.toISOString() };
  if (filter.text.trim()) query['text'] = filter.text.trim();
  const apiKeys = normalizeIds(filter.apiKeys);
  if (apiKeys.length) query['apiKeys'] = apiKeys.join(',');
  const signals = normalizeIds(filter.signals);
  if (signals.length) query['signals'] = signals.join(',');
  return query;
}

/**
 * Query params of the events page showing what a dashboard element counts: the dashboard
 * filters, its time range (a preset stays relative so the list keeps moving) or `window`
 * when given (a chart bucket), plus `extra` (e.g. levels for the error tile).
 */
export function eventsLinkParams(
  filter: DashboardFilter,
  extra: Partial<EventFilter> = {},
  window?: TimeWindow,
): QueryValues {
  const base: EventFilter = {
    ...DEFAULT_FILTER,
    text: filter.text.trim(),
    apiKeys: filter.apiKeys,
    signals: filter.signals,
  };
  if (window) {
    base.from = window.from.toISOString();
    base.to = window.to.toISOString();
  } else if (isCustomWindow(filter)) {
    base.from = filter.from;
    base.to = filter.to;
  } else {
    base.range = filter.range;
  }
  return filterToQueryParams({ ...base, ...extra });
}
