import { conditionSummary, formatMinutes, formatSuppression } from './condition-summary';

describe('formatMinutes', () => {
  it('uses the largest units that fit', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(10)).toBe('10 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(1440)).toBe('1 day');
    expect(formatMinutes(3060)).toBe('2 days 3 h');
  });
});

describe('formatSuppression', () => {
  it('describes how often an alert can notify', () => {
    expect(formatSuppression(0)).toBe('after every check');
    expect(formatSuppression(240)).toBe('at most once per 4 h');
  });
});

describe('conditionSummary', () => {
  it('names the signal', () => {
    expect(
      conditionSummary({ threshold: 5, windowMinutes: 10, filter: {} }, { signal: 'Errors' }),
    ).toBe('≥ 5 events in 10 min, matching Errors');
  });

  it('uses the singular for one event and says when there is no filter', () => {
    expect(conditionSummary({ threshold: 1, windowMinutes: 60, filter: null })).toBe(
      '≥ 1 event in 1 h (any event)',
    );
  });

  it('lists filter parts in a stable order', () => {
    const summary = conditionSummary(
      {
        threshold: 3,
        windowMinutes: 15,
        filter: {
          text: 'timeout',
          levels: ['Error', 'Fatal'],
          hasException: true,
          properties: ['App=Billing'],
          apiKeyIds: [3, 9],
        },
      },
      { signal: 'Production', apiKey: (id) => (id === 3 ? 'Billing' : undefined) },
    );
    expect(summary).toBe(
      '≥ 3 events in 15 min, matching Production, level Error/Fatal, text "timeout", ' +
        'with exception, App=Billing, API keys Billing, #9',
    );
  });
});
