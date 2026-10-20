import { displayMessage, isLogEvent, LogEvent } from './log-event';
import { displayPropertyValue } from './property-value';

const BASE: LogEvent = {
  id: 1,
  timestamp: '2026-10-20T12:00:00.000Z',
  arrived: '2026-10-20T12:00:00.010Z',
  level: 'warn',
  levelRank: 3,
  messageTemplate: 'Disk {Drive} is low',
  message: 'Disk "C" is low',
  exception: null,
  eventType: '$A1B2C3D4',
  traceId: null,
  spanId: null,
  apiKeyId: 3,
  properties: { Drive: 'C' },
};

describe('isLogEvent', () => {
  it('accepts a well-formed event', () => {
    expect(isLogEvent(JSON.parse(JSON.stringify(BASE)) as unknown)).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isLogEvent(null)).toBe(false);
    expect(isLogEvent({ ...BASE, id: '1' })).toBe(false);
    expect(isLogEvent({ ...BASE, properties: [] })).toBe(false);
    expect(isLogEvent({ ...BASE, traceId: undefined })).toBe(false);
    expect(isLogEvent({ ...BASE, apiKeyId: '3' })).toBe(false);
  });

  it('accepts a missing or null apiKeyId', () => {
    const { apiKeyId: _omitted, ...withoutKey } = BASE;
    expect(isLogEvent(withoutKey)).toBe(true);
    expect(isLogEvent({ ...BASE, apiKeyId: null })).toBe(true);
  });
});

describe('displayMessage', () => {
  it('prefers the rendered message, then the template, then the exception', () => {
    expect(displayMessage(BASE)).toBe('Disk "C" is low');
    expect(displayMessage({ ...BASE, message: null })).toBe('Disk {Drive} is low');
    expect(
      displayMessage({
        ...BASE,
        message: null,
        messageTemplate: null,
        exception: 'System.IO.IOException: boom\n   at Foo()',
      }),
    ).toBe('System.IO.IOException: boom');
    expect(displayMessage({ ...BASE, message: ' ', messageTemplate: null })).toBe('(no message)');
  });
});

describe('displayPropertyValue', () => {
  it('classifies scalars and pretty-prints structures', () => {
    expect(displayPropertyValue('x')).toEqual({ kind: 'string', text: 'x' });
    expect(displayPropertyValue(3)).toEqual({ kind: 'number', text: '3' });
    expect(displayPropertyValue(false)).toEqual({ kind: 'boolean', text: 'false' });
    expect(displayPropertyValue(null)).toEqual({ kind: 'null', text: 'null' });
    expect(displayPropertyValue({ a: [1] })).toEqual({
      kind: 'json',
      text: '{\n  "a": [\n    1\n  ]\n}',
    });
  });
});
