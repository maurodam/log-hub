import { Pipe, PipeTransform } from '@angular/core';
import { formatDateTime, formatTimeAgo } from '../utils/time-ago';

/** `{{ alert.lastTriggeredDate | timeAgo }}`: "5 min ago". See `formatTimeAgo`. */
@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return formatTimeAgo(iso);
  }
}

/** `{{ date | dateTime }}`: local `yyyy-MM-dd HH:mm:ss`. See `formatDateTime`. */
@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return formatDateTime(iso);
  }
}
