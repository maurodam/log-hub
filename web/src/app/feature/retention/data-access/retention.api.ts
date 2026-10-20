import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { skipErrorToast } from '../../../core/http/http-context';
import { API_BASE_URL } from '../../../core/config/app-config';
import { RetentionPolicy, RetentionPolicyInput } from '../models/retention';

/** Retention endpoints (docs/api/v1.md, Retention). All need `Project`. */
@Injectable({ providedIn: 'root' })
export class RetentionApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${inject(API_BASE_URL)}/v1`;
  /** GET: `RetentionPolicy[]`. */
  readonly policiesUrl = `${this.apiUrl}/retention`;
  /** GET: `StorageInfo`. */
  readonly storageUrl = `${this.apiUrl}/retention/storage`;
  /** GET: `Signal[]` (needs `Read`). */
  readonly signalsUrl = `${this.apiUrl}/signals`;

  /** `inline`: the caller shows errors itself (no global toast). */
  create(input: RetentionPolicyInput, inline = false): Observable<RetentionPolicy> {
    return this.http.post<RetentionPolicy>(this.policiesUrl, input, { context: inline ? skipErrorToast() : undefined });
  }

  update(id: number, input: RetentionPolicyInput, inline = false): Observable<RetentionPolicy> {
    return this.http.put<RetentionPolicy>(`${this.policiesUrl}/${id}`, input, { context: inline ? skipErrorToast() : undefined });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.policiesUrl}/${id}`);
  }

  /** Starts the retention job now (202). */
  run(): Observable<void> {
    return this.http.post<void>(`${this.policiesUrl}/run`, null);
  }
}
