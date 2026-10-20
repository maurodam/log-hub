import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi, AuthProviders } from './auth.api';

export type Permission = 'Ingest' | 'Read' | 'Write' | 'Project' | 'Organization' | 'System';

/** Every permission, lowest to highest (docs/api/v1.md). */
export const PERMISSIONS: readonly Permission[] = [
  'Ingest',
  'Read',
  'Write',
  'Project',
  'Organization',
  'System',
];

/** GET /api/v1/auth/me (docs/api/v1.md). */
export interface CurrentUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  permissions: Permission[];
  mustChangePassword: boolean;
  authProvider: 'Local' | 'Oidc' | 'ApiKey';
}

const FALLBACK_PROVIDERS: AuthProviders = {
  local: true,
  oidc: { enabled: false, displayName: null },
};

/**
 * Current session. Public API used by every feature: `user`, `isAuthenticated`, `hasPermission`.
 * The session itself is the `loghub.session` cookie; this service only mirrors `/auth/me`.
 */
@Service()
export class SessionService {
  private readonly api = inject(AuthApi);
  private pending: Promise<CurrentUser | null> | null = null;
  private loaded = false;

  readonly user = signal<CurrentUser | null>(null);
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly mustChangePassword = computed(() => this.user()?.mustChangePassword ?? false);
  /** Display name, falling back to the username. */
  readonly displayName = computed(() => {
    const user = this.user();
    return user ? user.displayName?.trim() || user.username : '';
  });

  hasPermission(permission: Permission): boolean {
    return this.user()?.permissions.includes(permission) ?? false;
  }

  /** Loads the session once; later calls reuse the result (guards call this on every navigation). */
  ensureLoaded(): Promise<CurrentUser | null> {
    if (this.loaded) return Promise.resolve(this.user());
    return (this.pending ??= this.load());
  }

  /** GET /auth/me. Any failure (401, server down) means "not signed in". */
  async load(): Promise<CurrentUser | null> {
    try {
      const user = await firstValueFrom(this.api.me());
      this.user.set(user);
    } catch (error: unknown) {
      if (!(error instanceof HttpErrorResponse)) throw error;
      this.user.set(null);
    } finally {
      this.loaded = true;
      this.pending = null;
    }
    return this.user();
  }

  /**
   * POST /auth/login, then GET /auth/me: the anti-forgery token is bound to the signed-in user, so
   * the XSRF-TOKEN cookie must be refreshed before the next POST/PUT/DELETE.
   */
  async login(username: string, password: string): Promise<CurrentUser> {
    const signedIn = await firstValueFrom(this.api.login(username, password));
    let user = signedIn;
    try {
      user = await firstValueFrom(this.api.me());
    } catch {
      // Keep the login response; the next request will refresh the cookie anyway.
    }
    this.user.set(user);
    this.loaded = true;
    return user;
  }

  /** POST /auth/logout. The local session is cleared even when the call fails. */
  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.clear();
    }
  }

  /** POST /auth/change-password, then reloads the user (clears `mustChangePassword`). */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(this.api.changePassword(currentPassword, newPassword));
    await this.load();
  }

  /** GET /auth/providers. Falls back to "local only" when the call fails. */
  async providers(): Promise<AuthProviders> {
    try {
      return await firstValueFrom(this.api.providers());
    } catch {
      return FALLBACK_PROVIDERS;
    }
  }

  /** Forgets the user locally (expired session, logout). */
  clear(): void {
    this.user.set(null);
    this.loaded = true;
  }

  /** Called when the API answers `password_change_required`. */
  requirePasswordChange(): void {
    this.user.update((user) => (user ? { ...user, mustChangePassword: true } : user));
  }
}
