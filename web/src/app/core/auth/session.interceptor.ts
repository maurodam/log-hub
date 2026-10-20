import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../config/app-config';
import { isPasswordChangeRequired } from '../http/http-error';
import { loginUrlTree } from './auth.guards';
import { isAuthPage } from './return-url';
import { SessionService } from './session.service';

/** Endpoints whose 401 is an answer, not an expired session. */
const NO_REDIRECT_ON_401 = ['/v1/auth/me', '/v1/auth/login'];

export type AuthErrorAction = 'login' | 'change-password' | null;

/** What to do with a failed API call: sign in again, change the password, or nothing. */
export function authErrorAction(error: unknown, url: string, apiBase: string): AuthErrorAction {
  if (!(error instanceof HttpErrorResponse) || !url.startsWith(`${apiBase}/v1/`)) return null;
  const path = url.slice(apiBase.length).split('?', 1)[0];
  if (error.status === 401) return NO_REDIRECT_ON_401.includes(path) ? null : 'login';
  if (isPasswordChangeRequired(error)) return 'change-password';
  return null;
}

/**
 * Session expiry handling for `/api/v1`: 401 clears the session and opens the login page (with
 * the current URL as `returnUrl`); `403 password_change_required` opens the change-password page.
 * The error is always rethrown so callers can stop their loading state.
 */
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBase = inject(API_BASE_URL);
  const session = inject(SessionService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const action = authErrorAction(error, req.url, apiBase);
      const current = currentUrl(router);
      if (action === 'login') {
        session.clear();
        if (!isAuthPage(current)) void router.navigateByUrl(loginUrlTree(router, current));
      } else if (action === 'change-password') {
        session.requirePasswordChange();
        if (!isAuthPage(current)) void router.navigateByUrl('/change-password');
      }
      return throwError(() => error);
    }),
  );
};

/** URL being navigated to (during the first navigation `router.url` is still `/`). */
function currentUrl(router: Router): string {
  const navigation = router.currentNavigation();
  const target = navigation?.finalUrl ?? navigation?.extractedUrl;
  return target ? router.serializeUrl(target) : router.url;
}
