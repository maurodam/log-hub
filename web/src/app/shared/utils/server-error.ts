import { HttpErrorResponse } from '@angular/common/http';

/** HTTP status of a failed request, or null for other errors. */
export function httpStatus(error: unknown): number | null {
  return error instanceof HttpErrorResponse ? error.status : null;
}

/**
 * Text to show for a failed request: the server `{"error": "..."}` (or ProblemDetails `detail`/`title`)
 * when present, otherwise `fallback`.
 */
export function serverErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'The server could not be reached.';
  const body: unknown = error.error;
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (typeof body !== 'object' || body === null) return fallback;
  const { error: message, detail, title } = body as Record<string, unknown>;
  return (
    [message, detail, title].find((v): v is string => typeof v === 'string' && !!v) ?? fallback
  );
}
