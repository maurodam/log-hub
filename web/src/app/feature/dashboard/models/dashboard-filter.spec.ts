import { convertToParamMap } from '@angular/router';
import { filterFromQueryParams } from '../../events/models/event-filter';
import {
  DashboardFilter,
  dashboardFilterFromParams,
  dashboardFilterToParams,
  DEFAULT_DASHBOARD_FILTER,
  eventsLinkParams,
  resolveWindow,
  statsQuery,
} from './dashboard-filter';

const NOW = new Date('2026-10-20T12:00:00.000Z');

const FULL: DashboardFilter = {
  range: '6h',
  from: '',
  to: '',
  signals: [1, 3],
  apiKeys: [4],
  text: 'timeout',
  autoRefresh: true,
};

describe('dashboard URL mapping', () => {
  it('defaults to the last 24 hours without filters', () => {
    expect(dashboardFilterFromParams(convertToParamMap({}))).toEqual(DEFAULT_DASHBOARD_FILTER);
    expect(dashboardFilterToParams(DEFAULT_DASHBOARD_FILTER)).toEqual({});
  });

  it('round-trips every parameter', () => {
    const params = dashboardFilterToParams(FULL);
    expect(params).toEqual({
      range: '6h',
      signals: '1,3',
      apiKeys: '4',
      text: 'timeout',
      auto: 'true',
    });
    expect(dashboardFilterFromParams(convertToParamMap(params))).toEqual(FULL);
  });

  it('rejects ranges the dashboard does not offer', () => {
    expect(dashboardFilterFromParams(convertToParamMap({ range: 'all' })).range).toBe('24h');
    expect(dashboardFilterFromParams(convertToParamMap({ range: '30d' })).range).toBe('30d');
  });

  it('keeps a custom window only when both bounds are valid and ordered', () => {
    const custom = dashboardFilterFromParams(
      convertToParamMap({ from: '2026-10-19T08:00:00Z', to: '2026-10-19T09:00:00Z', range: '1h' }),
    );
    expect(custom.from).toBe('2026-10-19T08:00:00.000Z');
    expect(custom.to).toBe('2026-10-19T09:00:00.000Z');
    expect(dashboardFilterToParams(custom)).toEqual({
      from: '2026-10-19T08:00:00.000Z',
      to: '2026-10-19T09:00:00.000Z',
    });

    const reversed = dashboardFilterFromParams(
      convertToParamMap({ from: '2026-10-19T09:00:00Z', to: '2026-10-19T08:00:00Z' }),
    );
    expect(reversed.from).toBe('');
    expect(reversed.to).toBe('');
    expect(
      dashboardFilterFromParams(convertToParamMap({ from: '2026-10-19T09:00:00Z' })).from,
    ).toBe('');
  });
});

describe('resolveWindow and statsQuery', () => {
  it('ends a preset window at now', () => {
    const window = resolveWindow(FULL, NOW);
    expect(window.from.toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(window.to).toEqual(NOW);
  });

  it('uses the custom window as is', () => {
    const window = resolveWindow(
      { ...FULL, from: '2026-10-19T08:00:00.000Z', to: '2026-10-19T09:00:00.000Z' },
      NOW,
    );
    expect(window.from.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-10-19T09:00:00.000Z');
  });

  it('builds the stats query from window and filters', () => {
    expect(statsQuery(FULL, resolveWindow(FULL, NOW))).toEqual({
      from: '2026-10-20T06:00:00.000Z',
      to: '2026-10-20T12:00:00.000Z',
      text: 'timeout',
      apiKeys: '4',
      signals: '1,3',
    });
    expect(
      statsQuery(DEFAULT_DASHBOARD_FILTER, resolveWindow(DEFAULT_DASHBOARD_FILTER, NOW)),
    ).toEqual({ from: '2026-10-19T12:00:00.000Z', to: '2026-10-20T12:00:00.000Z' });
  });
});

describe('eventsLinkParams', () => {
  it('keeps a preset relative and carries the filters', () => {
    expect(eventsLinkParams(FULL)).toEqual({
      text: 'timeout',
      apiKeys: '4',
      signals: '1,3',
      range: '6h',
    });
  });

  it('adds tile specific filters', () => {
    const params = eventsLinkParams(DEFAULT_DASHBOARD_FILTER, { levels: ['Error', 'Fatal'] });
    expect(params).toEqual({ levels: 'Error,Fatal', range: '24h' });
    expect(eventsLinkParams(DEFAULT_DASHBOARD_FILTER, { hasException: true })).toEqual({
      hasException: 'true',
      range: '24h',
    });
  });

  it('lets an explicit API key or event type replace the dashboard selection', () => {
    expect(eventsLinkParams(FULL, { apiKeys: [9] })['apiKeys']).toBe('9');
    expect(eventsLinkParams(FULL, { eventType: '$00FF00FF' })['eventType']).toBe('$00FF00FF');
  });

  it('opens a bucket as an absolute window the events page understands', () => {
    const window = {
      from: new Date('2026-10-20T10:00:00.000Z'),
      to: new Date('2026-10-20T10:30:00.000Z'),
    };
    const params = eventsLinkParams(FULL, {}, window);
    expect(params['from']).toBe('2026-10-20T10:00:00.000Z');
    expect(params['to']).toBe('2026-10-20T10:30:00.000Z');
    expect(params['range']).toBeUndefined();

    const events = filterFromQueryParams(convertToParamMap(params));
    expect(events.from).toBe('2026-10-20T10:00:00.000Z');
    expect(events.signals).toEqual([1, 3]);
    expect(events.apiKeys).toEqual([4]);
    expect(events.text).toBe('timeout');
  });

  it('passes a custom dashboard window through', () => {
    const custom = { ...FULL, from: '2026-10-19T08:00:00.000Z', to: '2026-10-19T09:00:00.000Z' };
    const params = eventsLinkParams(custom);
    expect(params['from']).toBe(custom.from);
    expect(params['to']).toBe(custom.to);
  });
});
