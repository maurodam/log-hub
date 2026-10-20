import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  GuardResult,
  MaybeAsync,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import {
  authGuard,
  guestGuard,
  homePath,
  homeRedirectGuard,
  permissionGuard,
  shellAccess,
  signedInGuard,
} from './auth.guards';
import { safeReturnUrl } from './return-url';
import { CurrentUser, Permission, SessionService } from './session.service';

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1,
    username: 'ada',
    displayName: null,
    email: null,
    permissions: ['Read'],
    mustChangePassword: false,
    authProvider: 'Local',
    ...overrides,
  };
}

function route(
  path: string,
  extra: { data?: Record<string, unknown>; query?: Record<string, string> } = {},
) {
  return {
    routeConfig: { path },
    data: extra.data ?? {},
    queryParamMap: convertToParamMap(extra.query ?? {}),
  } as unknown as ActivatedRouteSnapshot;
}

const state = (url: string) => ({ url }) as RouterStateSnapshot;

describe('auth guards', () => {
  let session: SessionService;
  let router: Router;

  /** Session already resolved (no HTTP call) with the given user. */
  function signIn(value: CurrentUser | null): void {
    session.clear();
    session.user.set(value);
  }

  async function run(guard: () => MaybeAsync<GuardResult>): Promise<string | boolean> {
    const raw = TestBed.runInInjectionContext(guard);
    const result = isObservable(raw) ? await firstValueFrom(raw) : await raw;
    return result instanceof UrlTree ? router.serializeUrl(result) : (result as boolean);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(SessionService);
    router = TestBed.inject(Router);
  });

  describe('shellAccess', () => {
    it('requires a user and a completed password change', () => {
      expect(shellAccess(null)).toBe('login');
      expect(shellAccess(user({ mustChangePassword: true }))).toBe('change-password');
      expect(shellAccess(user())).toBe('allow');
    });
  });

  describe('authGuard', () => {
    it('sends anonymous users to the login page with the return URL', async () => {
      signIn(null);
      expect(await run(() => authGuard(route('events'), state('/events?levels=Error')))).toBe(
        '/login?returnUrl=%2Fevents%3Flevels%3DError',
      );
    });

    it('omits the return URL for the root page', async () => {
      signIn(null);
      expect(await run(() => authGuard(route(''), state('/')))).toBe('/login');
    });

    it('forces the password change', async () => {
      signIn(user({ mustChangePassword: true }));
      expect(await run(() => authGuard(route('events'), state('/events')))).toBe(
        '/change-password',
      );
    });

    it('lets signed-in users through', async () => {
      signIn(user());
      expect(await run(() => authGuard(route('events'), state('/events')))).toBe(true);
    });
  });

  describe('permissionGuard', () => {
    it('uses the permission of the nav item', async () => {
      signIn(user({ permissions: ['Read'] }));
      expect(await run(() => permissionGuard(route('events'), state('/events')))).toBe(true);
      expect(await run(() => permissionGuard(route('users'), state('/users')))).toBe('/forbidden');
    });

    it('prefers data.permission', async () => {
      signIn(user({ permissions: ['Read'] }));
      const custom = route('custom', { data: { permission: 'System' } });
      expect(await run(() => permissionGuard(custom, state('/custom')))).toBe('/forbidden');
    });

    it('allows routes without a known permission', async () => {
      signIn(user({ permissions: [] }));
      expect(await run(() => permissionGuard(route('forbidden'), state('/forbidden')))).toBe(true);
    });
  });

  describe('homeRedirectGuard', () => {
    it('opens the first page the user may see', async () => {
      signIn(user({ permissions: ['Read'] }));
      expect(await run(() => homeRedirectGuard(route(''), state('/')))).toBe('/events');

      signIn(user({ permissions: ['Organization'] }));
      expect(await run(() => homeRedirectGuard(route(''), state('/')))).toBe('/users');
    });

    it('falls back to the no-access page', () => {
      const none = (_: Permission) => false;
      expect(homePath(none)).toBe('/forbidden');
    });
  });

  describe('guestGuard', () => {
    it('shows the login page to anonymous users', async () => {
      signIn(null);
      expect(await run(() => guestGuard(route('login'), state('/login')))).toBe(true);
    });

    it('sends signed-in users to a safe return URL', async () => {
      signIn(user());
      const safe = route('login', { query: { returnUrl: '/alerts' } });
      expect(await run(() => guestGuard(safe, state('/login')))).toBe('/alerts');

      const unsafe = route('login', { query: { returnUrl: 'https://evil.example' } });
      expect(await run(() => guestGuard(unsafe, state('/login')))).toBe('/');
    });
  });

  describe('signedInGuard', () => {
    it('requires a session for the change-password page', async () => {
      signIn(null);
      expect(
        await run(() => signedInGuard(route('change-password'), state('/change-password'))),
      ).toBe('/login');
      signIn(user());
      expect(
        await run(() => signedInGuard(route('change-password'), state('/change-password'))),
      ).toBe(true);
    });
  });
});

describe('safeReturnUrl', () => {
  it('accepts in-app paths only', () => {
    expect(safeReturnUrl('/events?levels=Error')).toBe('/events?levels=Error');
    expect(safeReturnUrl('https://evil.example')).toBeNull();
    expect(safeReturnUrl('//evil.example')).toBeNull();
    expect(safeReturnUrl('/\\evil.example')).toBeNull();
    expect(safeReturnUrl('/login?returnUrl=/x')).toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
  });
});
