import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { skipErrorToast } from '../../../core/http/http-context';
import { API_BASE_URL } from '../../../core/config/app-config';
import { Alert, AlertInput, AlertNotification } from '../models/alert';

/** Alert endpoints (docs/api/v1.md, Alerts): `Read` to list, `Project` to change. */
@Injectable({ providedIn: 'root' })
export class AlertsApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${inject(API_BASE_URL)}/v1`;
  /** GET: `Alert[]`. */
  readonly alertsUrl = `${this.apiUrl}/alerts`;
  /** GET: `Signal[]`. */
  readonly signalsUrl = `${this.apiUrl}/signals`;
  /** GET: `{ id, title }[]`. */
  readonly apiKeysUrl = `${this.apiUrl}/apikeys/lookup`;
  /** GET: `SmtpSettings` (needs `System`). */
  readonly smtpUrl = `${this.apiUrl}/settings/smtp`;

  notificationsUrl(alertId: number): string {
    return `${this.alertsUrl}/${alertId}/notifications`;
  }

  /** `inline`: the caller shows errors itself (no global toast). */
  create(input: AlertInput, inline = false): Observable<Alert> {
    return this.http.post<Alert>(this.alertsUrl, input, { context: inline ? skipErrorToast() : undefined });
  }

  update(id: number, input: AlertInput, inline = false): Observable<Alert> {
    return this.http.put<Alert>(`${this.alertsUrl}/${id}`, input, { context: inline ? skipErrorToast() : undefined });
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.alertsUrl}/${id}`);
  }

  /** Sends a test email to the alert recipients now. */
  test(id: number): Observable<void> {
    return this.http.post<void>(`${this.alertsUrl}/${id}/test`, null);
  }

  notifications(alertId: number): Observable<AlertNotification[]> {
    return this.http.get<AlertNotification[]>(this.notificationsUrl(alertId));
  }
}
