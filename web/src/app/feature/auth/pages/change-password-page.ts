import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, minLength, required, submit, validate } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideShieldAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { SessionService } from '../../../core/auth/session.service';
import { errorMessage } from '../../../core/http/http-error';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { AuthLayout } from '../components/auth-layout';

/** Minimum password length (docs/api/v1.md, "Password rules"). */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Voluntary or forced password change. In forced mode (`mustChangePassword`) the guards keep the
 * user here; the only way out is signing out.
 */
@Component({
  selector: 'app-change-password-page',
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
  providers: [provideIcons({ lucideCircleAlert, lucideShieldAlert })],
  template: `
    <app-auth-layout
      [heading]="forced() ? 'Set a new password' : 'Change password'"
      [description]="description()"
    >
      @if (isLocal()) {
        <form class="grid gap-4" novalidate (submit)="save($event)">
          @if (forced()) {
            <div hlmAlert>
              <ng-icon name="lucideShieldAlert" />
              <p hlmAlertDescription>Your password must be changed before you continue.</p>
            </div>
          }
          @if (failure(); as failure) {
            <div hlmAlert variant="destructive">
              <ng-icon name="lucideCircleAlert" />
              <p hlmAlertDescription>{{ failure }}</p>
            </div>
          }
          <input
            type="text"
            class="hidden"
            autocomplete="username"
            [value]="username()"
            aria-hidden="true"
            tabindex="-1"
          />
          <div class="grid gap-1.5">
            <label hlmLabel for="cp-current">Current password</label>
            <input
              hlmInput
              id="cp-current"
              type="password"
              autocomplete="current-password"
              [formField]="passwordForm.currentPassword"
              [forceInvalid]="invalid(passwordForm.currentPassword)"
            />
            <app-field-error [field]="passwordForm.currentPassword" />
          </div>
          <div class="grid gap-1.5">
            <label hlmLabel for="cp-new">New password</label>
            <input
              hlmInput
              id="cp-new"
              type="password"
              autocomplete="new-password"
              aria-describedby="cp-new-hint"
              [formField]="passwordForm.newPassword"
              [forceInvalid]="invalid(passwordForm.newPassword)"
            />
            <p id="cp-new-hint" class="text-muted-foreground text-xs">
              At least {{ minLength }} characters.
            </p>
            <app-field-error [field]="passwordForm.newPassword" />
          </div>
          <div class="grid gap-1.5">
            <label hlmLabel for="cp-confirm">Confirm new password</label>
            <input
              hlmInput
              id="cp-confirm"
              type="password"
              autocomplete="new-password"
              [formField]="passwordForm.confirmPassword"
              [forceInvalid]="invalid(passwordForm.confirmPassword)"
            />
            <app-field-error [field]="passwordForm.confirmPassword" />
          </div>
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            @if (forced()) {
              <button hlmBtn type="button" variant="ghost" [disabled]="busy()" (click)="signOut()">
                Sign out
              </button>
            } @else {
              <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="leave()">
                Cancel
              </button>
            }
            <button hlmBtn type="submit" [disabled]="busy()">
              @if (busy()) {
                <hlm-spinner />
              }
              Change password
            </button>
          </div>
        </form>
      } @else {
        <div class="grid gap-4">
          <p class="text-muted-foreground text-sm">
            Your account signs in with single sign-on. Change your password with your identity
            provider.
          </p>
          <button hlmBtn type="button" variant="outline" (click)="leave()">Back</button>
        </div>
      }
    </app-auth-layout>
  `,
})
export class ChangePasswordPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly minLength = MIN_PASSWORD_LENGTH;
  protected readonly forced = this.session.mustChangePassword;
  protected readonly isLocal = computed(() => this.session.user()?.authProvider === 'Local');
  protected readonly username = computed(() => this.session.user()?.username ?? '');
  protected readonly description = computed(() =>
    this.forced()
      ? `Signed in as ${this.session.displayName()}.`
      : 'Choose a new password for your account.',
  );

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly model = signal({ currentPassword: '', newPassword: '', confirmPassword: '' });
  protected readonly passwordForm = form(this.model, (path) => {
    required(path.currentPassword, { message: 'Enter your current password.' });
    required(path.newPassword, { message: 'Enter a new password.' });
    minLength(path.newPassword, MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
    validate(path.newPassword, ({ value, valueOf }) =>
      value() && value() === valueOf(path.currentPassword)
        ? { kind: 'sameAsCurrent', message: 'Choose a password different from the current one.' }
        : undefined,
    );
    required(path.confirmPassword, { message: 'Repeat the new password.' });
    validate(path.confirmPassword, ({ value, valueOf }) =>
      value() && value() !== valueOf(path.newPassword)
        ? { kind: 'mismatch', message: 'The passwords do not match.' }
        : undefined,
    );
  });

  protected readonly invalid = showFieldError;

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.passwordForm, async () => {
      const { currentPassword, newPassword } = this.model();
      this.failure.set(null);
      this.busy.set(true);
      try {
        await this.session.changePassword(currentPassword, newPassword);
        toast.success('Password changed');
        await this.router.navigateByUrl('/');
      } catch (error: unknown) {
        this.failure.set(errorMessage(error) ?? 'The password could not be changed.');
      } finally {
        this.busy.set(false);
      }
      return undefined;
    });
  }

  protected leave(): void {
    void this.router.navigateByUrl('/');
  }

  protected async signOut(): Promise<void> {
    try {
      await this.session.logout();
    } catch {
      // The local session is cleared anyway.
    }
    await this.router.navigateByUrl('/login');
  }
}
