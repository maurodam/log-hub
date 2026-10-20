/** A stored log event as returned by `/api/v1/events`. */
export interface LogEvent {
  id: number;
  /** ISO 8601 timestamp of the event itself. */
  timestamp: string;
  /** ISO 8601 timestamp of when the server received the event. */
  arrived: string;
  /** Original level text as sent by the producer (e.g. "Information", "warn"). */
  level: string;
  /** Normalized level: 0 Verbose, 1 Debug, 2 Information, 3 Warning, 4 Error, 5 Fatal. */
  levelRank: number;
  messageTemplate: string | null;
  message: string | null;
  exception: string | null;
  eventType: string;
  traceId: string | null;
  spanId: string | null;
  /** API key the event was ingested with; null when unknown or sent without a key. */
  apiKeyId: number | null;
  properties: Record<string, unknown>;
}

/** One page of events, newest first. `nextCursor` is null when there are no older events. */
export interface LogEventPage {
  events: LogEvent[];
  nextCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** `apiKeyId` may be missing in payloads from older servers. */
function isOptionalId(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || typeof value === 'number';
}

/** Runtime check for payloads that do not go through HttpClient (e.g. Server-Sent Events). */
export function isLogEvent(value: unknown): value is LogEvent {
  return (
    isRecord(value) &&
    typeof value['id'] === 'number' &&
    typeof value['timestamp'] === 'string' &&
    typeof value['arrived'] === 'string' &&
    typeof value['level'] === 'string' &&
    typeof value['levelRank'] === 'number' &&
    typeof value['eventType'] === 'string' &&
    isNullableString(value['messageTemplate']) &&
    isNullableString(value['message']) &&
    isNullableString(value['exception']) &&
    isNullableString(value['traceId']) &&
    isNullableString(value['spanId']) &&
    isOptionalId(value['apiKeyId']) &&
    isRecord(value['properties'])
  );
}

/** Text shown on the collapsed row: rendered message, falling back to template or exception. */
export function displayMessage(event: LogEvent): string {
  const text = event.message ?? event.messageTemplate ?? firstLine(event.exception);
  return text?.trim() ? text : '(no message)';
}

function firstLine(text: string | null): string | null {
  return text?.split(/\r?\n/, 1)[0] ?? null;
}
