import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { toast } from '@spartan-ng/brain/sonner';
import { catchError, throwError } from 'rxjs';
import { SKIP_ERROR_TOAST } from './http-context';
import { errorMessage, isPasswordChangeRequired } from './http-error';

/**
 * Shows a toast for every failed HTTP call, then rethrows so callers can still react.
 * Skipped: 401 and "password change required" (the session interceptor redirects instead) and
 * requests marked with `SKIP_ERROR_TOAST` (the caller shows the error inline).
 */
export const apiErrorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status !== 401 &&
        !isPasswordChangeRequired(error) &&
        !req.context.get(SKIP_ERROR_TOAST)
      ) {
        toast.error(errorTitle(error), {
          description: errorMessage(error) ?? `${req.method} ${req.urlWithParams}`,
        });
      }
      return throwError(() => error);
    }),
  );

function errorTitle(error: HttpErrorResponse): string {
  if (error.status === 0) return 'Server unreachable';
  if (error.status === 403) return 'Permission denied';
  return `Request failed (${error.status})`;
}
