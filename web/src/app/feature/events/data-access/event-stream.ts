import { Observable } from 'rxjs';
import { isLogEvent, LogEvent } from '../models/log-event';

/** `connecting` also covers the browser's automatic reconnects; `failed` means it gave up. */
export type StreamStatus = 'connecting' | 'open' | 'failed';

export type StreamMessage =
  { kind: 'status'; status: StreamStatus } | { kind: 'event'; event: LogEvent };

/**
 * Wraps an `EventSource` reading `event: log` messages. Pings and malformed payloads are ignored.
 * The browser reconnects on its own (sending Last-Event-ID); unsubscribing closes the connection.
 */
export function eventSource(url: string): Observable<StreamMessage> {
  return new Observable<StreamMessage>((subscriber) => {
    const source = new EventSource(url);
    subscriber.next({ kind: 'status', status: 'connecting' });

    const onLog = (message: MessageEvent<unknown>) => {
      const event = parseJson(message.data);
      if (isLogEvent(event)) subscriber.next({ kind: 'event', event });
    };
    source.addEventListener('log', onLog);
    source.onopen = () => subscriber.next({ kind: 'status', status: 'open' });
    source.onerror = () =>
      subscriber.next({
        kind: 'status',
        status: source.readyState === EventSource.CLOSED ? 'failed' : 'connecting',
      });

    return () => {
      source.removeEventListener('log', onLog);
      source.close();
    };
  });
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}
