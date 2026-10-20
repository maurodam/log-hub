import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  GuardResult,
  Router,
  UrlTree,
} from '@angular/router';
import { NAV_ITEMS } from '../layout/nav-items';
import { safeReturnUrl } from './return-url';
import { CurrentUser, Permission, SessionService } from './session.service';

/** `/login?returnUrl=<url>`; the return URL is dropped when it is not a safe in-app path. */
export function loginUrlTree(router: Router, returnUrl: string | null): UrlTree {
  const target = safeReturnUrl(returnUrl);
  return router.createUrlTree(['/login'], {
    queryParams: target && target !== '/' ? { returnUrl: target } : {},
  });
}

/**
 * Decision for the authenticated area: `login` when there is no session, `change-password` while
 * a password change is due, otherwise `allow`.
 */
export function shellAccess(user: CurrentUser | null): 'login' | 'change-password' | 'allow' {
  if (!user) return 'login';
  if (user.mustChangePassword) return 'change-password';
  return 'allow';
}

/** Permission required by a route: `data.permission`, else the matching `NAV_ITEMS` entry. */
export function requiredPermission(route: ActivatedRouteSnapshot): Permission | null {
  const fromData: unknown = route.data['permission'];
  if (typeof fromData === 'string') return fromData as Permission;
  const path = route.routeConfig?.path;
  return NAV_ITEMS.find((item) => item.path === `/${path}`)?.permission ?? null;
}

/** First navigation entry the user may open, or `/forbidden` when there is none. */
export function homePath(hasPermission: (permission: Permission) => boolean): string {
  return NAV_ITEMS.find((item) => hasPermission(item.permission))?.path ?? '/forbidden';
}

/** `canActivate` + `canActivateChild` of the shell: session required, password change enforced. */
export const authGuard: CanActivateFn = async (_route, state): Promise<GuardResult> => {
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.ensureLoaded();
  switch (shellAccess(user)) {
    case 'login':
      return loginUrlTree(router, state.url);
    case 'change-password':
      return router.parseUrl('/change-password');
    case 'allow':
      return true;
  }
};

/** Feature routes: the permission of the nav item (or `data.permission`) is required. */
export const permissionGuard: CanActivateFn = (route): GuardResult => {
  const session = inject(SessionService);
  const permission = requiredPermission(route);
  if (!permission || session.hasPermission(permission)) return true;
  return inject(Router).parseUrl('/forbidden');
};

/** Empty path of the shell: sends the user to the first page they may open. */
export const homeRedirectGuard: CanActivateFn = (): GuardResult => {
  const session = inject(SessionService);
  return inject(Router).parseUrl(homePath((p) => session.hasPermission(p)));
};

/** `/login`: already signed-in users go straight to the app. */
export const guestGuard: CanActivateFn = async (route): Promise<GuardResult> => {
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.ensureLoaded();
  if (!user) return true;
  if (user.mustChangePassword) return router.parseUrl('/change-password');
  const returnUrl: unknown = route.queryParamMap.get('returnUrl');
  return router.parseUrl(safeReturnUrl(typeof returnUrl === 'string' ? returnUrl : null) ?? '/');
};

/** `/change-password`: needs a session (forced or voluntary change). */
export const signedInGuard: CanActivateFn = async (_route, state): Promise<GuardResult> => {
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.ensureLoaded();
  return user ? true : loginUrlTree(router, state.url);
};
