import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { skipErrorToast } from '../../../core/http/http-context';
import { API_BASE_URL } from '../../../core/config/app-config';
import { SmtpSettings, SmtpSettingsInput } from '../models/smtp-settings';

/** SMTP settings endpoints (docs/api/v1.md, Email notifications). All need `System`. */
@Injectable({ providedIn: 'root' })
export class SmtpApi {
  private readonly http = inject(HttpClient);
  /** GET: `SmtpSettings`. */
  readonly settingsUrl = `${inject(API_BASE_URL)}/v1/settings/smtp`;

  save(input: SmtpSettingsInput): Observable<SmtpSettings> {
    return this.http.put<SmtpSettings>(this.settingsUrl, input, { context: skipErrorToast() });
  }

  /** Sends a test email with the saved settings. 502 with `{error}` when sending fails. */
  sendTest(to: string): Observable<void> {
    return this.http.post<void>(`${this.settingsUrl}/test`, { to }, { context: skipErrorToast() });
  }
}
