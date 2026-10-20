import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  homeRedirectGuard,
  permissionGuard,
  signedInGuard,
} from './core/auth/auth.guards';
import { AppShell } from './core/layout/app-shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in - LogHub',
    canActivate: [guestGuard],
    loadComponent: () => import('./feature/auth/pages/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'change-password',
    title: 'Change password - LogHub',
    canActivate: [signedInGuard],
    loadComponent: () =>
      import('./feature/auth/pages/change-password-page').then((m) => m.ChangePasswordPage),
  },
  {
    path: '',
    component: AppShell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [homeRedirectGuard], children: [] },
      // permissionGuard reads the required permission from NAV_ITEMS (core/layout/nav-items.ts).
      { path: 'events', canActivate: [permissionGuard], loadChildren: () => import('./feature/events/events.routes') },
      { path: 'dashboard', canActivate: [permissionGuard], loadChildren: () => import('./feature/dashboard/dashboard.routes') },
      { path: 'alerts', canActivate: [permissionGuard], loadChildren: () => import('./feature/alerts/alerts.routes') },
      { path: 'apikeys', canActivate: [permissionGuard], loadChildren: () => import('./feature/apikeys/apikeys.routes') },
      { path: 'users', canActivate: [permissionGuard], loadChildren: () => import('./feature/users/users.routes') },
      { path: 'retention', canActivate: [permissionGuard], loadChildren: () => import('./feature/retention/retention.routes') },
      { path: 'email', canActivate: [permissionGuard], loadChildren: () => import('./feature/email/email.routes') },
      {
        path: 'forbidden',
        title: 'No access - LogHub',
        loadComponent: () =>
          import('./feature/auth/pages/forbidden-page').then((m) => m.ForbiddenPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
