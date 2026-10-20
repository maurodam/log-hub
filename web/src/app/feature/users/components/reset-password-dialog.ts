import { Component, inject, signal } from '@angular/core';
import { form, FormField, minLength, required, submit, validate } from '@angular/forms/signals';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { firstValueFrom } from 'rxjs';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { UsersApi } from '../data-access/users.api';
import { User } from '../models/user';

const MIN_PASSWORD_LENGTH = 12;

export interface ResetPasswordContext {
  user: User;
}

/** Sets a new password for a local user. Closes with true when saved. */
@Component({
  selector: 'app-reset-password-dialog',
  imports: [
    FieldError,
    FormField,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    HlmSwitch,
  ],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>Reset password</h2>
      <p hlmDialogDescription>Set a new password for {{ user.displayName || user.username }}.</p>
    </hlm-dialog-header>

    <form id="reset-password-form" class="grid gap-4" novalidate (submit)="save($event)">
      <input
        type="text"
        class="hidden"
        autocomplete="username"
        [value]="user.username"
        aria-hidden="true"
        tabindex="-1"
      />
      <div class="grid gap-1.5">
        <label hlmLabel for="rp-new">New password</label>
        <input
          hlmInput
          id="rp-new"
          type="password"
          autocomplete="new-password"
          [formField]="passwordForm.newPassword"
          [forceInvalid]="invalid(passwordForm.newPassword)"
        />
        <app-field-error [field]="passwordForm.newPassword" />
      </div>
      <div class="grid gap-1.5">
        <label hlmLabel for="rp-confirm">Confirm password</label>
        <input
          hlmInput
          id="rp-confirm"
          type="password"
          autocomplete="new-password"
          [formField]="passwordForm.confirmPassword"
          [forceInvalid]="invalid(passwordForm.confirmPassword)"
        />
        <app-field-error [field]="passwordForm.confirmPassword" />
      </div>
      <div class="flex items-start justify-between gap-4">
        <label for="rp-must-change" class="grid gap-0.5 text-sm">
          <span class="font-medium">Must change password</span>
          <span class="text-muted-foreground text-xs"
            >Ask for a new password at the next sign-in.</span
          >
        </label>
        <hlm-switch
          inputId="rp-must-change"
          [checked]="mustChangePassword()"
          (checkedChange)="mustChangePassword.set($event)"
        />
      </div>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="cancel()">
        Cancel
      </button>
      <button hlmBtn type="submit" form="reset-password-form" [disabled]="busy()">
        @if (busy()) {
          <hlm-spinner />
        }
        Reset password
      </button>
    </hlm-dialog-footer>
  `,
})
export class ResetPasswordDialog {
  private readonly api = inject(UsersApi);
  private readonly dialogRef = inject<BrnDialogRef<boolean>>(BrnDialogRef);
  protected readonly user = injectBrnDialogContext<ResetPasswordContext>().user;

  protected readonly model = signal({ newPassword: '', confirmPassword: '' });
  protected readonly passwordForm = form(this.model, (path) => {
    required(path.newPassword, { message: 'Enter a new password.' });
    minLength(path.newPassword, MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
    required(path.confirmPassword, { message: 'Repeat the new password.' });
    validate(path.confirmPassword, ({ value, valueOf }) =>
      value() && value() !== valueOf(path.newPassword)
        ? { kind: 'mismatch', message: 'The passwords do not match.' }
        : undefined,
    );
  });
  protected readonly mustChangePassword = signal(true);
  protected readonly busy = signal(false);
  protected readonly invalid = showFieldError;

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.passwordForm, async () => {
      this.busy.set(true);
      try {
        await firstValueFrom(
          this.api.resetPassword(this.user.id, {
            newPassword: this.model().newPassword,
            mustChangePassword: this.mustChangePassword(),
          }),
        );
        this.dialogRef.close(true);
      } catch {
        // The error toast explains the failure; keep the dialog open.
      } finally {
        this.busy.set(false);
      }
      return undefined;
    });
  }

  protected cancel(): void {
    this.dialogRef.close();
  }
}
