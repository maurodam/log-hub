import { HttpErrorResponse } from '@angular/common/http';

interface ErrorBody {
  title?: unknown;
  detail?: unknown;
  error?: unknown;
  code?: unknown;
}

/** Error code sent by the API when a password change is due (docs/api/v1.md). */
export const PASSWORD_CHANGE_REQUIRED = 'password_change_required';

function errorBody(error: unknown): ErrorBody | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null ? (body as ErrorBody) : undefined;
}

/** Message from a ProblemDetails or `{ "error": "..." }` body, if the server sent one. */
export function errorMessage(error: unknown): string | undefined {
  const body = errorBody(error);
  if (!body) return undefined;
  const { detail, error: message, title } = body;
  return [detail, message, title].find((value): value is string => typeof value === 'string');
}

/** Machine-readable `code` of an API error body, if any. */
export function errorCode(error: unknown): string | undefined {
  const code = errorBody(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** True for `403 { code: "password_change_required" }`. */
export function isPasswordChangeRequired(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    error.status === 403 &&
    errorCode(error) === PASSWORD_CHANGE_REQUIRED
  );
}
