import { Pipe, PipeTransform } from '@angular/core';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/**
 * Formats an ISO timestamp in local time as `HH:mm:ss.SSS`, prefixed with `yyyy-MM-dd`
 * when it is not on the same local day as `now`. Invalid input is returned unchanged.
 */
export function formatLocalTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? time
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/** `{{ event.timestamp | localTime }}`: see `formatLocalTime`. */
@Pipe({ name: 'localTime' })
export class LocalTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return iso ? formatLocalTime(iso) : '';
  }
}
