/** Pages that must never be used as a return target after signing in. */
const AUTH_PAGES = ['/login', '/change-password'];

/**
 * Accepts only same-app absolute paths (`/events?x=1`). Rejects external and protocol-relative
 * URLs (`https://evil`, `//evil`, `/\evil`) and the auth pages themselves.
 */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null;
  }
  const path = value.split(/[?#]/, 1)[0];
  return AUTH_PAGES.includes(path) ? null : value;
}

/** True for the pages that are reachable without (or before completing) a session. */
export function isAuthPage(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return AUTH_PAGES.includes(path);
}
