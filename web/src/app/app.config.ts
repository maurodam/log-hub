import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideSpartanHlm } from '@spartan-ng/helm/utils';
import { routes } from './app.routes';
import { sessionInterceptor } from './core/auth/session.interceptor';
import { apiErrorInterceptor } from './core/http/api-error.interceptor';
import { ThemeService } from './core/layout/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition }) => {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            transition.skipTransition();
          }
        },
      }),
    ),
    provideHttpClient(
      withInterceptors([sessionInterceptor, apiErrorInterceptor]),
      // Session cookie auth: Angular copies the XSRF-TOKEN cookie into X-XSRF-TOKEN on every
      // relative POST/PUT/PATCH/DELETE, including /api/v1/auth/login and /api/v1/auth/logout.
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
    ),
    provideSpartanHlm(),
    // Apply the stored theme before the first render.
    provideAppInitializer(() => {
      inject(ThemeService);
    }),
  ],
};
