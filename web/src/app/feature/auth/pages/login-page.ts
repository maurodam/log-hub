import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DOCUMENT, inject, input, signal } from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideLogIn } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { AuthApi, AuthProviders } from '../../../core/auth/auth.api';
import { safeReturnUrl } from '../../../core/auth/return-url';
import { SessionService } from '../../../core/auth/session.service';
import { errorMessage } from '../../../core/http/http-error';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { AuthLayout } from '../components/auth-layout';

/** User-facing text for a failed POST /auth/login. */
export function loginFailureMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Sign in failed.';
  if (error.status === 429) return 'Too many attempts, wait a minute.';
  if (error.status === 0) return 'Cannot reach the server. Try again in a moment.';
  if (error.status === 401) return errorMessage(error) ?? 'Wrong username or password.';
  return errorMessage(error) ?? `Sign in failed (${error.status}).`;
}

@Component({
  selector: 'app-login-page',
  imports: [
    AuthLayout,
    FormField,
    FieldError,
    HlmAlertImports,
    HlmButton,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    NgIcon,
  ],
  providers: [provideIcons({ lucideCircleAlert, lucideLogIn })],
  template: `
    <app-auth-layout heading="Sign in" description="Sign in to search and monitor your logs.">
      <div class="grid gap-4">
        @if (failure(); as failure) {
          <div hlmAlert variant="destructive">
            <ng-icon name="lucideCircleAlert" />
            <p hlmAlertDescription>{{ failure }}</p>
          </div>
        }

        @if (localEnabled()) {
          <form class="grid gap-4" novalidate (submit)="signIn($event)">
            <div class="grid gap-1.5">
              <label hlmLabel for="login-username">Username</label>
              <input
                hlmInput
                id="login-username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                [formField]="loginForm.username"
                [forceInvalid]="invalid(loginForm.username)"
              />
              <app-field-error [field]="loginForm.username" />
            </div>
            <div class="grid gap-1.5">
              <label hlmLabel for="login-password">Password</label>
              <input
                hlmInput
                id="login-password"
                type="password"
                autocomplete="current-password"
                [formField]="loginForm.password"
                [forceInvalid]="invalid(loginForm.password)"
              />
              <app-field-error [field]="loginForm.password" />
            </div>
            <button hlmBtn type="submit" class="w-full" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner />
              }
              Sign in
            </button>
          </form>
        }

        @if (oidcName(); as name) {
          @if (localEnabled()) {
            <div class="text-muted-foreground flex items-center gap-3 text-xs">
              <span class="bg-border h-px flex-1"></span>
              or
              <span class="bg-border h-px flex-1"></span>
            </div>
          }
          <button hlmBtn type="button" variant="outline" class="w-full" (click)="signInWithOidc()">
            <ng-icon name="lucideLogIn" />
            Sign in with {{ name }}
          </button>
        }
      </div>
    </app-auth-layout>
  `,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  /** Query parameter: where to go after signing in. */
  readonly returnUrl = input<string>();
  /** Query parameter: error reported by the single sign-on callback, if any. */
  readonly error = input<string>();

  protected readonly providers = signal<AuthProviders | null>(null);
  protected readonly busy = signal(false);
  private readonly submitError = signal<string | null>(null);
  protected readonly failure = computed(() => this.submitError() ?? this.error() ?? null);

  protected readonly localEnabled = computed(() => this.providers()?.local ?? true);
  protected readonly oidcName = computed(() => {
    const oidc = this.providers()?.oidc;
    return oidc?.enabled ? oidc.displayName?.trim() || 'single sign-on' : null;
  });

  protected readonly model = signal({ username: '', password: '' });
  protected readonly loginForm = form(this.model, (path) => {
    required(path.username, { message: 'Enter your username.' });
    required(path.password, { message: 'Enter your password.' });
  });

  protected readonly invalid = showFieldError;

  constructor() {
    void this.session.providers().then((providers) => this.providers.set(providers));
  }

  protected signIn(event: Event): void {
    event.preventDefault();
    void submit(this.loginForm, async () => {
      const { username, password } = this.model();
      this.submitError.set(null);
      this.busy.set(true);
      try {
        const user = await this.session.login(username.trim(), password);
        const target = user.mustChangePassword
          ? '/change-password'
          : (safeReturnUrl(this.returnUrl()) ?? '/');
        await this.router.navigateByUrl(target);
      } catch (error: unknown) {
        this.submitError.set(loginFailureMessage(error));
      } finally {
        this.busy.set(false);
      }
      return undefined;
    });
  }

  /** Full page navigation: the server redirects to the identity provider and back. */
  protected signInWithOidc(): void {
    const returnUrl = safeReturnUrl(this.returnUrl()) ?? '/';
    this.document.location.assign(this.authApi.oidcLoginUrl(returnUrl));
  }
}
