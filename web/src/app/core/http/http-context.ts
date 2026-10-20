import { HttpContext, HttpContextToken } from '@angular/common/http';

/** Set on requests whose errors the caller shows itself (no global error toast). */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

/** `http.post(url, body, { context: skipErrorToast() })` */
export function skipErrorToast(context = new HttpContext()): HttpContext {
  return context.set(SKIP_ERROR_TOAST, true);
}
