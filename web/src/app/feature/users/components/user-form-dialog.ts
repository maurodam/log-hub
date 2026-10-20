import { Component, inject, signal } from '@angular/core';
import {
  email,
  form,
  FormField,
  maxLength,
  minLength,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
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
import { emptyToNull, Role, User } from '../models/user';
import { RolePicker } from './role-picker';

/** Minimum password length (docs/api/v1.md, "Password rules"). */
const MIN_PASSWORD_LENGTH = 12;

export interface UserFormContext {
  /** User to edit; null creates a new local user. */
  user: User | null;
  roles: readonly Role[];
  /** Id of the signed-in user: they cannot disable themselves. */
  selfId: number | null;
}

/** Create / edit dialog for a user. Saves itself and closes with the saved user. */
@Component({
  selector: 'app-user-form-dialog',
  imports: [
    FieldError,
    FormField,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    HlmSwitch,
    RolePicker,
  ],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ original ? 'Edit ' + original.username : 'New user' }}</h2>
      <p hlmDialogDescription>
        {{
          original
            ? 'Change profile, roles and access.'
            : 'Create a local account. Roles decide what the user can do.'
        }}
      </p>
    </hlm-dialog-header>

    <form
      id="user-form"
      class="-mx-4 grid max-h-[65vh] gap-4 overflow-y-auto px-4"
      novalidate
      (submit)="save($event)"
    >
      @if (!original) {
        <div class="grid gap-1.5">
          <label hlmLabel for="uf-username">Username</label>
          <input
            hlmInput
            id="uf-username"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            [formField]="userForm.username"
            [forceInvalid]="invalid(userForm.username)"
          />
          <app-field-error [field]="userForm.username" />
        </div>
      }
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid content-start gap-1.5">
          <label hlmLabel for="uf-display-name">Display name</label>
          <input
            hlmInput
            id="uf-display-name"
            autocomplete="off"
            [formField]="userForm.displayName"
          />
          <app-field-error [field]="userForm.displayName" />
        </div>
        <div class="grid content-start gap-1.5">
          <label hlmLabel for="uf-email">Email</label>
          <input
            hlmInput
            id="uf-email"
            type="email"
            autocomplete="off"
            [formField]="userForm.email"
            [forceInvalid]="invalid(userForm.email)"
          />
          <app-field-error [field]="userForm.email" />
        </div>
      </div>
      @if (!original) {
        <div class="grid gap-1.5">
          <label hlmLabel for="uf-password">Initial password</label>
          <input
            hlmInput
            id="uf-password"
            type="password"
            autocomplete="new-password"
            [formField]="userForm.password"
            [forceInvalid]="invalid(userForm.password)"
          />
          <app-field-error [field]="userForm.password" />
        </div>
        <div class="flex items-start justify-between gap-4">
          <label for="uf-must-change" class="grid gap-0.5 text-sm">
            <span class="font-medium">Must change password</span>
            <span class="text-muted-foreground text-xs"
              >Ask for a new password at the first sign-in.</span
            >
          </label>
          <hlm-switch
            inputId="uf-must-change"
            [checked]="mustChangePassword()"
            (checkedChange)="mustChangePassword.set($event)"
          />
        </div>
      }

      <app-role-picker [roles]="context.roles" [(selected)]="roleIds" />

      @if (original) {
        <div class="flex items-start justify-between gap-4">
          <label for="uf-disabled" class="grid gap-0.5 text-sm">
            <span class="font-medium">Disabled</span>
            <span class="text-muted-foreground text-xs">
              {{
                isSelf ? 'You cannot disable your own account.' : 'Disabled users cannot sign in.'
              }}
            </span>
          </label>
          <hlm-switch
            inputId="uf-disabled"
            [checked]="isDisabled()"
            [disabled]="isSelf"
            (checkedChange)="isDisabled.set($event)"
          />
        </div>
      }
    </form>

    <hlm-dialog-footer>
      <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="cancel()">
        Cancel
      </button>
      <button hlmBtn type="submit" form="user-form" [disabled]="busy()">
        @if (busy()) {
          <hlm-spinner />
        }
        {{ original ? 'Save changes' : 'Create user' }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class UserFormDialog {
  private readonly api = inject(UsersApi);
  private readonly dialogRef = inject<BrnDialogRef<User>>(BrnDialogRef);
  protected readonly context = injectBrnDialogContext<UserFormContext>();
  protected readonly original = this.context.user;
  protected readonly isSelf = this.original !== null && this.original.id === this.context.selfId;

  protected readonly model = signal({
    username: '',
    displayName: this.original?.displayName ?? '',
    email: this.original?.email ?? '',
    password: '',
  });
  protected readonly userForm = form(this.model, (path) => {
    const creating = () => this.original === null;
    required(path.username, { message: 'Enter a username.', when: creating });
    pattern(path.username, /^\S+$/, { message: 'Do not use spaces.', when: creating });
    maxLength(path.username, 100, { message: 'Use at most 100 characters.' });
    maxLength(path.displayName, 200, { message: 'Use at most 200 characters.' });
    email(path.email, { message: 'Enter a valid email address.' });
    required(path.password, { message: 'Enter an initial password.', when: creating });
    minLength(path.password, MIN_PASSWORD_LENGTH, {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      when: creating,
    });
  });
  protected readonly roleIds = signal<number[]>(this.original?.roleIds ?? []);
  protected readonly mustChangePassword = signal(true);
  protected readonly isDisabled = signal(this.original?.isDisabled ?? false);
  protected readonly busy = signal(false);
  protected readonly invalid = showFieldError;

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.userForm, async () => {
      this.busy.set(true);
      try {
        this.dialogRef.close(await this.persist());
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

  private persist(): Promise<User> {
    const { username, displayName, email: mail, password } = this.model();
    if (this.original) {
      return firstValueFrom(
        this.api.update(this.original.id, {
          displayName: displayName.trim(),
          email: emptyToNull(mail),
          roleIds: this.roleIds(),
          isDisabled: this.isDisabled(),
        }),
      );
    }
    return firstValueFrom(
      this.api.create({
        username: username.trim(),
        displayName: displayName.trim(),
        email: emptyToNull(mail),
        password,
        roleIds: this.roleIds(),
        mustChangePassword: this.mustChangePassword(),
      }),
    );
  }
}
