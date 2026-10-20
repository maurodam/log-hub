import { DEFAULT_FILTER, EventFilter } from './event-filter';
import { describeFilterSpec, filterSpecFromEventFilter, isEmptyFilterSpec } from './signal-filter';

const TOOLBAR: EventFilter = {
  ...DEFAULT_FILTER,
  text: '  timeout ',
  levels: ['Fatal', 'Error'],
  range: '24h',
  traceId: 'abc',
  eventType: '$A1B2C3D4',
  properties: [
    { name: 'App', value: 'Billing' },
    { name: 'Code', value: '"42"' },
  ],
  apiKeys: [7, 3],
  hasException: true,
  signals: [1, 2],
};

describe('filterSpecFromEventFilter', () => {
  it('maps every toolbar filter to the FilterSpec fields', () => {
    expect(filterSpecFromEventFilter(TOOLBAR)).toEqual({
      text: 'timeout',
      levels: ['Error', 'Fatal'],
      properties: ['App=Billing', 'Code="42"'],
      apiKeyIds: [3, 7],
      hasException: true,
      traceId: 'abc',
      eventType: '$A1B2C3D4',
    });
  });

  it('leaves out unset fields, the time range and the selected signals', () => {
    expect(
      filterSpecFromEventFilter({
        ...DEFAULT_FILTER,
        range: '1h',
        from: '2026-10-20T10:00:00.000Z',
        signals: [5],
      }),
    ).toEqual({});
    expect(filterSpecFromEventFilter({ ...DEFAULT_FILTER, levels: ['Warning'] })).toEqual({
      levels: ['Warning'],
    });
  });
});

describe('describeFilterSpec', () => {
  it('lists the parts in a stable order with API key titles', () => {
    const parts = describeFilterSpec(filterSpecFromEventFilter(TOOLBAR), (id) =>
      id === 3 ? 'Billing' : `#${id}`,
    );
    expect(parts).toEqual([
      { label: 'text', value: 'timeout' },
      { label: 'levels', value: 'Error, Fatal' },
      { label: 'property', value: 'App=Billing' },
      { label: 'property', value: 'Code="42"' },
      { label: 'API keys', value: 'Billing, #7' },
      { label: 'exception', value: 'yes' },
      { label: 'trace', value: 'abc' },
      { label: 'type', value: '$A1B2C3D4' },
    ]);
  });

  it('isEmptyFilterSpec ignores null and empty values', () => {
    expect(isEmptyFilterSpec({})).toBe(true);
    expect(
      isEmptyFilterSpec({
        text: ' ',
        levels: [],
        hasException: false,
        traceId: null,
        apiKeyIds: null,
      }),
    ).toBe(true);
    expect(isEmptyFilterSpec({ hasException: true })).toBe(false);
  });
});
