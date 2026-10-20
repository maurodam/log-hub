import { Alert } from './alert';
import {
  buildFilterSpec,
  draftFromAlert,
  draftToInput,
  emptyDraft,
  parsePropertyEntry,
  propertyRowError,
  wholeNumberError,
} from './alert-form';

describe('buildFilterSpec', () => {
  it('sends an empty filter when nothing is set', () => {
    expect(buildFilterSpec(emptyDraft())).toEqual({});
  });

  it('builds every field from the editor', () => {
    const spec = buildFilterSpec({
      ...emptyDraft(),
      text: '  timeout ',
      levels: ['Fatal', 'Error'],
      hasException: true,
      apiKeyIds: [7, 3, 7],
      properties: [
        { name: ' App ', value: 'Billing' },
        { name: 'Attempt', value: '42' },
        { name: '', value: '' },
        { name: 'Code', value: '"42"' },
      ],
    });
    expect(spec).toEqual({
      text: 'timeout',
      levels: ['Error', 'Fatal'],
      properties: ['App=Billing', 'Attempt=42', 'Code="42"'],
      apiKeyIds: [3, 7],
      hasException: true,
    });
  });

  it('leaves out hasException when the switch is off', () => {
    expect(buildFilterSpec({ ...emptyDraft(), hasException: false }).hasException).toBeUndefined();
  });

  it('keeps trace and event type filters the editor does not show', () => {
    const alert: Alert = {
      id: 1,
      title: 'Payments',
      description: null,
      signalId: 2,
      filter: {
        traceId: 'abc',
        eventType: '$A1B2C3D4',
        properties: ['Order=12=3'],
        levels: ['error'],
      },
      threshold: 3,
      windowMinutes: 10,
      suppressionMinutes: 60,
      recipients: ['ops@example.com'],
      isEnabled: true,
      lastCheckedDate: null,
      lastTriggeredDate: null,
      lastError: null,
    };
    const draft = draftFromAlert(alert);
    expect(draft.properties).toEqual([{ name: 'Order', value: '12=3' }]);
    expect(draft.levels).toEqual(['Error']);
    expect(buildFilterSpec(draft)).toEqual({
      levels: ['Error'],
      properties: ['Order=12=3'],
      traceId: 'abc',
      eventType: '$A1B2C3D4',
    });
  });
});

describe('draftToInput', () => {
  it('trims text and turns an empty description into null', () => {
    const input = draftToInput({
      ...emptyDraft(),
      title: ' Errors spike ',
      description: '   ',
      threshold: 5,
      windowMinutes: 10,
      suppressionMinutes: 0,
      recipients: ['ops@example.com'],
    });
    expect(input).toEqual({
      title: 'Errors spike',
      description: null,
      signalId: null,
      filter: {},
      threshold: 5,
      windowMinutes: 10,
      suppressionMinutes: 0,
      recipients: ['ops@example.com'],
      isEnabled: true,
    });
  });
});

describe('property rows', () => {
  it('splits entries at the first "="', () => {
    expect(parsePropertyEntry('App=Billing')).toEqual({ name: 'App', value: 'Billing' });
    expect(parsePropertyEntry('Flag')).toEqual({ name: 'Flag', value: '' });
  });

  it('validates names', () => {
    expect(propertyRowError({ name: '', value: '' })).toBeNull();
    expect(propertyRowError({ name: '', value: 'x' })).toBe('Enter a property name.');
    expect(propertyRowError({ name: 'a=b', value: 'x' })).toContain('=');
    expect(propertyRowError({ name: 'App', value: '' })).toBeNull();
  });
});

describe('wholeNumberError', () => {
  it('requires whole numbers above the minimum', () => {
    expect(wholeNumberError(1, 1, 'Threshold')).toBeNull();
    expect(wholeNumberError(0, 1, 'Threshold')).toContain('at least 1');
    expect(wholeNumberError(1.5, 1, 'Threshold')).not.toBeNull();
    expect(wholeNumberError(null, 0, 'Suppression')).not.toBeNull();
    expect(wholeNumberError(0, 0, 'Suppression')).toBeNull();
  });
});
