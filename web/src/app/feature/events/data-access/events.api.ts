import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/app-config';
import { QueryValues } from '../models/event-filter';
import { LogEventPage } from '../models/log-event';
import { eventSource, StreamMessage } from './event-stream';

export interface PageRequest {
  count: number;
  cursor?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(API_BASE_URL)}/v1/events`;

  /** One page of events matching `query`, newest first. */
  list(query: QueryValues, page: PageRequest): Observable<LogEventPage> {
    let params = new HttpParams({ fromObject: query }).set('count', page.count);
    if (page.cursor) params = params.set('cursor', page.cursor);
    return this.http.get<LogEventPage>(this.baseUrl, { params });
  }

  /**
   * Events created after connecting. The stream is same-origin, so the browser sends the session
   * cookie by itself.
   */
  stream(query: QueryValues): Observable<StreamMessage> {
    const params = new HttpParams({ fromObject: query });
    return eventSource(`${this.baseUrl}/stream?${params.toString()}`);
  }
}
