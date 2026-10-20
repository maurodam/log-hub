import { InjectionToken } from '@angular/core';

export const APP_NAME = 'LogHub';

/** Base path of the LogHub HTTP API (proxied to the backend in dev). */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
