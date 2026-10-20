import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/app-config';
import { skipErrorToast } from '../http/http-context';
import type { CurrentUser } from './session.service';

/** GET /api/v1/auth/providers */
export interface AuthProviders {
  local: boolean;
  oidc: { enabled: boolean; displayName: string | null };
}

/** HTTP calls of `/api/v1/auth/*` (docs/api/v1.md). State lives in `SessionService`. */
@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly baseUrl = `${this.apiBase}/v1/auth`;

  me(): Observable<CurrentUser> {
    return this.http.get<CurrentUser>(`${this.baseUrl}/me`);
  }

  /** 401 = wrong credentials or locked, 429 = rate limited. The login page shows the error. */
  login(username: string, password: string): Observable<CurrentUser> {
    return this.http.post<CurrentUser>(
      `${this.baseUrl}/login`,
      { username, password },
      { context: skipErrorToast() },
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/logout`, null);
  }

  /** 400 `{ error }` when the current password is wrong or the new one is rejected. */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(
      `${this.baseUrl}/change-password`,
      { currentPassword, newPassword },
      { context: skipErrorToast() },
    );
  }

  providers(): Observable<AuthProviders> {
    return this.http.get<AuthProviders>(`${this.baseUrl}/providers`, {
      context: skipErrorToast(),
    });
  }

  /** Full-page URL that starts the OpenID Connect login (browser navigation, not XHR). */
  oidcLoginUrl(returnUrl: string): string {
    return `${this.baseUrl}/oidc/login?returnUrl=${encodeURIComponent(returnUrl)}`;
  }
}
