import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/config/app-config';
import { skipErrorToast } from '../../core/http/http-context';
import { LogSignal, SignalInput } from '../models/signal';

/**
 * `/api/v1/signals`: shared signals plus the caller's own. List, create and update errors are
 * shown by the caller (panel, dialog), so they skip the global error toast.
 */
@Injectable({ providedIn: 'root' })
export class SignalsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(API_BASE_URL)}/v1/signals`;

  list(): Observable<LogSignal[]> {
    return this.http.get<LogSignal[]>(this.baseUrl, { context: skipErrorToast() });
  }

  create(input: SignalInput): Observable<LogSignal> {
    return this.http.post<LogSignal>(this.baseUrl, input, { context: skipErrorToast() });
  }

  update(id: number, input: SignalInput): Observable<LogSignal> {
    return this.http.put<LogSignal>(`${this.baseUrl}/${id}`, input, {
      context: skipErrorToast(),
    });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
