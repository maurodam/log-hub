import { LogEvent } from '../models/log-event';
import { appendEvents, prependEvents } from './event-buffer';

function event(id: number): LogEvent {
  return {
    id,
    timestamp: '2026-10-20T12:00:00.000Z',
    arrived: '2026-10-20T12:00:00.010Z',
    level: 'Information',
    levelRank: 2,
    messageTemplate: null,
    message: `event ${id}`,
    exception: null,
    eventType: '$00000000',
    traceId: null,
    spanId: null,
    apiKeyId: null,
    properties: {},
  };
}

const ids = (events: readonly LogEvent[]) => events.map((e) => e.id);

describe('prependEvents', () => {
  it('puts new events on top and skips known ids', () => {
    const result = prependEvents([event(3), event(2)], [event(5), event(4), event(3), event(5)]);
    expect(ids(result.events)).toEqual([5, 4, 3, 2]);
    expect(result.trimmed).toBe(false);
  });

  it('drops the oldest events beyond the cap', () => {
    const result = prependEvents([event(3), event(2), event(1)], [event(5), event(4)], 4);
    expect(ids(result.events)).toEqual([5, 4, 3, 2]);
    expect(result.trimmed).toBe(true);
  });
});

describe('appendEvents', () => {
  it('appends an older page without duplicates', () => {
    expect(ids(appendEvents([event(5), event(4)], [event(4), event(3)]))).toEqual([5, 4, 3]);
  });
});
