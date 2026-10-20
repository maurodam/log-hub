import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { authErrorAction, sessionInterceptor } from './session.interceptor';
import { CurrentUser, SessionService } from './session.service';

const error = (status: number, body: unknown = null) =>
  new HttpErrorResponse({ status, error: body, url: '/api/v1/events' });

describe('authErrorAction', () => {
  it('asks for a new login on 401 from the API', () => {
    expect(authErrorAction(error(401), '/api/v1/events', '/api')).toBe('login');
    expect(authErrorAction(error(401), '/api/v1/apikeys/3?x=1', '/api')).toBe('login');
  });

  it('ignores 401 from /auth/me and /auth/login', () => {
    expect(authErrorAction(error(401), '/api/v1/auth/me', '/api')).toBeNull();
    expect(authErrorAction(error(401), '/api/v1/auth/login', '/api')).toBeNull();
  });

  it('opens the change-password page for password_change_required', () => {
    const forced = error(403, { error: 'Change your password', code: 'password_change_required' });
    expect(authErrorAction(forced, '/api/v1/events', '/api')).toBe('change-password');
    expect(
      authErrorAction(error(403, { error: 'Forbidden' }), '/api/v1/events', '/api'),
    ).toBeNull();
  });

  it('ignores other errors and other URLs', () => {
    expect(authErrorAction(error(500), '/api/v1/events', '/api')).toBeNull();
    expect(authErrorAction(error(401), '/health', '/api')).toBeNull();
    expect(authErrorAction(new Error('boom'), '/api/v1/events', '/api')).toBeNull();
  });
});

describe('sessionInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: SessionService;
  let router: Router;
  let navigated: string[];

  const signedIn: CurrentUser = {
    id: 1,
    username: 'ada',
    displayName: null,
    email: null,
    permissions: ['Read'],
    mustChangePassword: false,
    authProvider: 'Local',
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'events', children: [] },
          { path: 'login', children: [] },
          { path: 'change-password', children: [] },
        ]),
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    session = TestBed.inject(SessionService);
    router = TestBed.inject(Router);
    session.user.set(signedIn);
    await router.navigateByUrl('/events?levels=Error');

    navigated = [];
    vi.spyOn(router, 'navigateByUrl').mockImplementation((url: string | UrlTree) => {
      navigated.push(typeof url === 'string' ? url : router.serializeUrl(url));
      return Promise.resolve(true);
    });
  });

  afterEach(() => backend.verify());

  it('clears the session and opens the login page on 401, then rethrows', () => {
    let status = 0;
    http.get('/api/v1/events').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    backend
      .expectOne('/api/v1/events')
      .flush({ error: 'Not authenticated' }, { status: 401, statusText: 'Unauthorized' });

    expect(status).toBe(401);
    expect(session.user()).toBeNull();
    expect(navigated).toEqual(['/login?returnUrl=%2Fevents%3Flevels%3DError']);
  });

  it('does not redirect for 401 from /auth/me', () => {
    http.get('/api/v1/auth/me').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(navigated).toEqual([]);
    expect(session.user()).toEqual(signedIn);
  });

  it('opens the change-password page on password_change_required', () => {
    http.get('/api/v1/events').subscribe({ error: () => undefined });
    backend
      .expectOne('/api/v1/events')
      .flush(
        { error: 'Password change required', code: 'password_change_required' },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(navigated).toEqual(['/change-password']);
    expect(session.mustChangePassword()).toBe(true);
  });

  it('leaves plain 403 alone', () => {
    http.get('/api/v1/users').subscribe({ error: () => undefined });
    backend
      .expectOne('/api/v1/users')
      .flush({ error: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(navigated).toEqual([]);
    expect(session.user()).toEqual(signedIn);
  });
});
