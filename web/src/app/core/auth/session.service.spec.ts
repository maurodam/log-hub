import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CurrentUser, SessionService } from './session.service';

const ME = '/api/v1/auth/me';

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1,
    username: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    permissions: ['Read', 'Write'],
    mustChangePassword: false,
    authProvider: 'Local',
    ...overrides,
  };
}

const unauthorized = { status: 401, statusText: 'Unauthorized' };

/** Lets awaited HTTP calls inside the service reach the next request. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('SessionService', () => {
  let session: SessionService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
        ),
        provideHttpClientTesting(),
      ],
    });
    session = TestBed.inject(SessionService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('loads the current user from /auth/me', async () => {
    const loading = session.ensureLoaded();
    backend.expectOne(ME).flush(user());

    expect(await loading).toEqual(user());
    expect(session.isAuthenticated()).toBe(true);
    expect(session.hasPermission('Read')).toBe(true);
    expect(session.hasPermission('System')).toBe(false);
    expect(session.displayName()).toBe('Ada Lovelace');
  });

  it('treats 401 from /auth/me as signed out and does not ask again', async () => {
    const loading = session.ensureLoaded();
    backend.expectOne(ME).flush({ error: 'Not authenticated' }, unauthorized);

    expect(await loading).toBeNull();
    expect(session.isAuthenticated()).toBe(false);

    expect(await session.ensureLoaded()).toBeNull();
    backend.expectNone(ME);
  });

  it('shares one request between concurrent callers', async () => {
    const first = session.ensureLoaded();
    const second = session.ensureLoaded();
    backend.expectOne(ME).flush(user());
    expect(await first).toEqual(await second);
  });

  it('signs in, then refreshes the XSRF cookie through /auth/me', async () => {
    const signingIn = session.login('ada', 'secret-password');

    const login = backend.expectOne('/api/v1/auth/login');
    expect(login.request.method).toBe('POST');
    expect(login.request.body).toEqual({ username: 'ada', password: 'secret-password' });
    login.flush(user({ displayName: null }));
    await tick();

    backend.expectOne(ME).flush(user());
    expect(await signingIn).toEqual(user());
    expect(session.user()).toEqual(user());
  });

  it('sends the XSRF header on the login POST', () => {
    document.cookie = 'XSRF-TOKEN=token-123; path=/';
    void session.login('ada', 'pw').catch(() => undefined);

    const login = backend.expectOne('/api/v1/auth/login');
    expect(login.request.headers.get('X-XSRF-TOKEN')).toBe('token-123');
    login.flush({ error: 'Invalid username or password' }, unauthorized);
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('rejects a failed login and stays signed out', async () => {
    const signingIn = session.login('ada', 'wrong');
    backend
      .expectOne('/api/v1/auth/login')
      .flush({ error: 'Invalid username or password' }, unauthorized);

    await expect(signingIn).rejects.toMatchObject({ status: 401 });
    expect(session.user()).toBeNull();
  });

  it('clears the session on logout even when the call fails', async () => {
    session.user.set(user());
    const loggingOut = session.logout();
    backend.expectOne('/api/v1/auth/logout').flush(null, { status: 500, statusText: 'Error' });

    await expect(loggingOut).rejects.toMatchObject({ status: 500 });
    expect(session.user()).toBeNull();
  });

  it('reloads the user after changing the password', async () => {
    session.user.set(user({ mustChangePassword: true }));
    const changing = session.changePassword('old-password-1', 'new-password-12');

    const change = backend.expectOne('/api/v1/auth/change-password');
    expect(change.request.body).toEqual({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-12',
    });
    change.flush(null, { status: 204, statusText: 'No Content' });
    await tick();

    backend.expectOne(ME).flush(user());
    await changing;
    expect(session.mustChangePassword()).toBe(false);
  });

  it('falls back to local login when the providers call fails', async () => {
    const providers = session.providers();
    backend.expectOne('/api/v1/auth/providers').flush(null, { status: 500, statusText: 'Error' });
    expect(await providers).toEqual({ local: true, oidc: { enabled: false, displayName: null } });
  });

  it('marks a forced password change locally', () => {
    session.user.set(user());
    session.requirePasswordChange();
    expect(session.mustChangePassword()).toBe(true);
  });
});
