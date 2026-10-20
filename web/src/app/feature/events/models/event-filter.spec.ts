import { convertToParamMap } from '@angular/router';
import {
  DEFAULT_FILTER,
  EventFilter,
  filterFromQueryParams,
  filterToQueryParams,
  hasActiveFilters,
  hasCustomRange,
  listQuery,
  normalizeIds,
  parseIdList,
  parseIsoDate,
  rangeStart,
  sameFilter,
  streamQuery,
} from './event-filter';

const NOW = new Date('2026-10-20T12:00:00.000Z');

const FULL: EventFilter = {
  text: 'timeout',
  levels: ['Warning', 'Error'],
  range: '1h',
  from: '',
  to: '',
  traceId: 'abc123',
  eventType: '$A1B2C3D4',
  properties: [
    { name: 'Tenant', value: 'acme' },
    { name: 'StatusCode', value: '500' },
  ],
  apiKeys: [2, 7],
  hasException: true,
  signals: [1, 4],
};

describe('filterFromQueryParams', () => {
  it('returns the default filter for an empty URL', () => {
    expect(filterFromQueryParams(convertToParamMap({}))).toEqual(DEFAULT_FILTER);
  });

  it('reads every supported parameter', () => {
    const params = convertToParamMap({
      text: ' timeout ',
      levels: 'error,Warning',
      range: '1h',
      traceId: 'abc123',
      eventType: '$A1B2C3D4',
      property: ['Tenant=acme', 'StatusCode=500'],
      apiKeys: '7,2',
      hasException: 'true',
      signals: '4,1',
    });
    expect(filterFromQueryParams(params)).toEqual(FULL);
  });

  it('ignores unknown levels, invalid ranges and malformed or duplicate properties', () => {
    const params = convertToParamMap({
      levels: 'Error,Loud,Error',
      range: '3w',
      property: ['NoSeparator', '=value', 'A=1', 'A=1'],
    });
    expect(filterFromQueryParams(params)).toEqual({
      ...DEFAULT_FILTER,
      levels: ['Error'],
      properties: [{ name: 'A', value: '1' }],
    });
  });

  it('drops junk from id lists and ignores hasException values other than true/1', () => {
    const params = convertToParamMap({
      apiKeys: '3,x,-1,0,3, 5',
      signals: '',
      hasException: 'yes',
    });
    const filter = filterFromQueryParams(params);
    expect(filter.apiKeys).toEqual([3, 5]);
    expect(filter.signals).toEqual([]);
    expect(filter.hasException).toBe(false);
    expect(filterFromQueryParams(convertToParamMap({ hasException: '1' })).hasException).toBe(true);
  });

  it('reads an absolute window and lets it override the relative range', () => {
    const params = convertToParamMap({
      range: '24h',
      from: '2026-10-20T10:00:00Z',
      to: '2026-10-20T10:30:00+00:00',
    });
    const filter = filterFromQueryParams(params);
    expect(filter.from).toBe('2026-10-20T10:00:00.000Z');
    expect(filter.to).toBe('2026-10-20T10:30:00.000Z');
    expect(filter.range).toBe('all');
    expect(hasCustomRange(filter)).toBe(true);
  });

  it('ignores invalid dates', () => {
    const filter = filterFromQueryParams(convertToParamMap({ from: 'yesterday', range: '6h' }));
    expect(filter.from).toBe('');
    expect(filter.range).toBe('6h');
  });

  it('treats a selection of every level as no level filter', () => {
    const params = convertToParamMap({ levels: 'Verbose,Debug,Information,Warning,Error,Fatal' });
    expect(filterFromQueryParams(params).levels).toEqual([]);
  });

  it('keeps everything after the first "=" as the property value', () => {
    const params = convertToParamMap({ property: 'Query=a=b' });
    expect(filterFromQueryParams(params).properties).toEqual([{ name: 'Query', value: 'a=b' }]);
  });
});

describe('filterToQueryParams', () => {
  it('omits defaults', () => {
    expect(filterToQueryParams(DEFAULT_FILTER)).toEqual({});
  });

  it('round-trips through the URL', () => {
    const params = filterToQueryParams(FULL);
    expect(params).toEqual({
      text: 'timeout',
      levels: 'Warning,Error',
      traceId: 'abc123',
      eventType: '$A1B2C3D4',
      property: ['Tenant=acme', 'StatusCode=500'],
      apiKeys: '2,7',
      hasException: 'true',
      signals: '1,4',
      range: '1h',
    });
    expect(filterFromQueryParams(convertToParamMap(params))).toEqual(FULL);
  });

  it('writes from/to instead of range for an absolute window', () => {
    const custom: EventFilter = {
      ...DEFAULT_FILTER,
      range: '7d',
      from: '2026-10-20T10:00:00.000Z',
      to: '2026-10-20T10:30:00.000Z',
    };
    const params = filterToQueryParams(custom);
    expect(params).toEqual({ from: custom.from, to: custom.to });
    expect(filterFromQueryParams(convertToParamMap(params))).toEqual({ ...custom, range: 'all' });
  });

  it('sorts and de-duplicates id lists', () => {
    expect(filterToQueryParams({ ...DEFAULT_FILTER, apiKeys: [9, 2, 9], signals: [5, 1] })).toEqual(
      { apiKeys: '2,9', signals: '1,5' },
    );
  });
});

describe('API queries', () => {
  it('streamQuery carries every filter except the time range', () => {
    expect(streamQuery({ ...FULL, from: '2026-10-20T10:00:00.000Z' })).toEqual({
      text: 'timeout',
      levels: 'Warning,Error',
      traceId: 'abc123',
      eventType: '$A1B2C3D4',
      property: ['Tenant=acme', 'StatusCode=500'],
      apiKeys: '2,7',
      hasException: 'true',
      signals: '1,4',
    });
  });

  it('listQuery resolves the time range against now', () => {
    expect(listQuery(FULL, NOW)['from']).toBe('2026-10-20T11:00:00.000Z');
    expect(listQuery(DEFAULT_FILTER, NOW)).toEqual({});
  });

  it('listQuery passes absolute bounds through', () => {
    const query = listQuery(
      { ...DEFAULT_FILTER, from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
      NOW,
    );
    expect(query).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
  });

  it('rangeStart is null for "all"', () => {
    expect(rangeStart('all', NOW)).toBeNull();
    expect(rangeStart('15m', NOW)?.toISOString()).toBe('2026-10-20T11:45:00.000Z');
    expect(rangeStart('6h', NOW)?.toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(rangeStart('30d', NOW)?.toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });
});

describe('helpers', () => {
  it('parseIdList keeps positive integers only, sorted and unique', () => {
    expect(parseIdList('10, 2,2,abc,1.5,-3,0')).toEqual([2, 10]);
    expect(parseIdList(null)).toEqual([]);
    expect(normalizeIds([3, 1, 3])).toEqual([1, 3]);
  });

  it('parseIsoDate normalizes valid dates', () => {
    expect(parseIsoDate('2026-10-20T12:00:00+02:00')).toBe('2026-10-20T10:00:00.000Z');
    expect(parseIsoDate('  ')).toBe('');
    expect(parseIsoDate('not a date')).toBe('');
  });
});

describe('filter comparison', () => {
  it('sameFilter ignores level and id order', () => {
    expect(sameFilter({ ...FULL, levels: ['Error', 'Warning'] }, FULL)).toBe(true);
    expect(sameFilter({ ...FULL, signals: [4, 1], apiKeys: [7, 2] }, FULL)).toBe(true);
    expect(sameFilter({ ...FULL, text: 'other' }, FULL)).toBe(false);
  });

  it('hasActiveFilters is false only for the default filter', () => {
    expect(hasActiveFilters(DEFAULT_FILTER)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTER, range: '24h' })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTER, signals: [1] })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTER, hasException: true })).toBe(true);
  });
});
