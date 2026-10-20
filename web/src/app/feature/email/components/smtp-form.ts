import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import {
  disabled,
  email,
  form,
  FormField,
  FormRoot,
  required,
  validate,
} from '@angular/forms/signals';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { toast } from '@spartan-ng/brain/sonner';
import { firstValueFrom } from 'rxjs';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { serverErrorMessage } from '../../../shared/utils/server-error';
import { SmtpApi } from '../data-access/smtp.api';
import {
  isHttpUrl,
  isValidPort,
  SMTP_SECURITY_OPTIONS,
  SmtpSecurity,
  SmtpSettings,
  smtpModelChanged,
  toSmtpInput,
  toSmtpModel,
} from '../models/smtp-settings';

/** SMTP server settings form. Emits the saved settings. */
@Component({
  selector: 'app-smtp-form',
  imports: [
    FieldError,
    FormField,
    FormRoot,
    HlmButton,
    HlmCardImports,
    HlmInput,
    HlmLabel,
    HlmSelectImports,
    HlmSpinner,
  ],
  template: `
    <form hlmCard [formRoot]="smtpForm" aria-labelledby="smtp-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="smtp-title">SMTP server</h3>
        <p hlmCardDescription>LogHub sends alert notifications through this server.</p>
      </div>

      <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
        <div class="grid content-start gap-1.5">
          <label hlmLabel for="smtp-host">Host</label>
          <input
            hlmInput
            id="smtp-host"
            autocomplete="off"
            spellcheck="false"
            placeholder="smtp.example.com"
            class="font-mono"
            [formField]="smtpForm.host"
            [attr.aria-invalid]="showError(smtpForm.host) || null"
          />
          <app-field-error [field]="smtpForm.host" />
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <div class="grid content-start gap-1.5">
            <label hlmLabel for="smtp-security">Security</label>
            <hlm-select
              [formField]="smtpForm.security"
              [itemToString]="securityLabel"
              (valueChange)="onSecurityChange($event)"
            >
              <hlm-select-trigger buttonId="smtp-security" class="w-full">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (option of securityOptions; track option.value) {
                  <hlm-select-item [value]="option.value">{{ option.label }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>
          <div class="grid content-start gap-1.5">
            <label hlmLabel for="smtp-port">Port</label>
            <input
              hlmInput
              id="smtp-port"
              type="number"
              inputmode="numeric"
              class="font-mono"
              [formField]="smtpForm.port"
              [attr.aria-invalid]="showError(smtpForm.port) || null"
            />
          </div>
          <div class="col-span-2 -mt-2 empty:hidden">
            <app-field-error [field]="smtpForm.port" />
          </div>
        </div>

        <div class="grid content-start gap-1.5">
          <label hlmLabel for="smtp-username">Username</label>
          <input
            hlmInput
            id="smtp-username"
            autocomplete="off"
            spellcheck="false"
            placeholder="Optional"
            [formField]="smtpForm.username"
          />
        </div>

        <div class="grid content-start gap-1.5">
          <label hlmLabel for="smtp-password">Password</label>
          <input
            hlmInput
            id="smtp-password"
            type="password"
            autocomplete="new-password"
            aria-describedby="smtp-password-hint"
            [placeholder]="settings().hasPassword ? 'Unchanged' : 'Optional'"
            [formField]="smtpForm.password"
          />
          <p id="smtp-password-hint" class="text-muted-foreground text-xs">
            {{
              settings().hasPassword
                ? 'A password is stored. Leave empty to keep it.'
                : 'No password stored.'
            }}
          </p>
        </div>

        <div class="grid content-start gap-1.5">
          <label hlmLabel for="smtp-from-address">From address</label>
          <input
            hlmInput
            id="smtp-from-address"
            type="email"
            autocomplete="off"
            spellcheck="false"
            placeholder="loghub@example.com"
            [formField]="smtpForm.fromAddress"
            [attr.aria-invalid]="showError(smtpForm.fromAddress) || null"
          />
          <app-field-error [field]="smtpForm.fromAddress" />
        </div>

        <div class="grid content-start gap-1.5">
          <label hlmLabel for="smtp-from-name">From name</label>
          <input
            hlmInput
            id="smtp-from-name"
            autocomplete="off"
            placeholder="LogHub"
            [formField]="smtpForm.fromName"
          />
        </div>

        <div class="grid content-start gap-1.5 sm:col-span-2">
          <label hlmLabel for="smtp-public-url">LogHub public URL</label>
          <input
            hlmInput
            id="smtp-public-url"
            type="url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://logs.example.com"
            class="font-mono"
            aria-describedby="smtp-public-url-hint"
            [formField]="smtpForm.publicUrl"
            [attr.aria-invalid]="showError(smtpForm.publicUrl) || null"
          />
          <app-field-error [field]="smtpForm.publicUrl" />
          <p id="smtp-public-url-hint" class="text-muted-foreground text-xs">
            Used for the links in alert emails. Without it, emails contain no links.
          </p>
        </div>

        @if (serverError(); as message) {
          <p class="text-destructive text-sm sm:col-span-2" role="alert">{{ message }}</p>
        }
      </div>

      @if (!readOnly()) {
        <div hlmCardFooter class="justify-end gap-2">
          @if (changed()) {
            <span class="text-muted-foreground me-auto text-xs">Unsaved changes</span>
          }
          <button
            hlmBtn
            type="button"
            variant="ghost"
            [disabled]="!changed() || smtpForm().submitting()"
            (click)="discard()"
          >
            Discard
          </button>
          <button hlmBtn type="submit" [disabled]="!changed() || smtpForm().submitting()">
            @if (smtpForm().submitting()) {
              <hlm-spinner />
            }
            Save settings
          </button>
        </div>
      }
    </form>
  `,
})
export class SmtpForm {
  readonly settings = input.required<SmtpSettings>();
  /** Settings come from environment variables, or the user cannot change them. */
  readonly readOnly = input(false);
  readonly saved = output<SmtpSettings>();

  private readonly api = inject(SmtpApi);

  protected readonly securityOptions = SMTP_SECURITY_OPTIONS;
  protected readonly showError = showFieldError;
  protected readonly serverError = signal<string | null>(null);

  protected readonly model = linkedSignal(() => toSmtpModel(this.settings()));
  protected readonly changed = computed(() => smtpModelChanged(this.model(), this.settings()));

  protected readonly smtpForm = form(
    this.model,
    (path) => {
      disabled(path, () => this.readOnly());
      required(path.host, { message: 'Enter the SMTP server host name.' });
      validate(path.port, ({ value }) =>
        isValidPort(value())
          ? undefined
          : { kind: 'port', message: 'Enter a port between 1 and 65535.' },
      );
      required(path.fromAddress, { message: 'Enter the sender address.' });
      email(path.fromAddress, { message: 'Enter a valid email address.' });
      validate(path.publicUrl, ({ value }) =>
        value().trim() && !isHttpUrl(value())
          ? { kind: 'url', message: 'Enter a full address, e.g. https://logs.example.com.' }
          : undefined,
      );
    },
    { submission: { action: () => this.save() } },
  );

  protected readonly securityLabel = (value: SmtpSecurity) =>
    SMTP_SECURITY_OPTIONS.find((option) => option.value === value)?.label ?? value;

  /** Moves the port along with the security mode while it still has a default value. */
  protected onSecurityChange(security: SmtpSecurity | null | undefined): void {
    const option = SMTP_SECURITY_OPTIONS.find((item) => item.value === security);
    const port = this.model().port;
    if (!option || !SMTP_SECURITY_OPTIONS.some((item) => item.port === port)) return;
    this.smtpForm.port().value.set(option.port);
  }

  protected discard(): void {
    this.serverError.set(null);
    this.smtpForm().reset(toSmtpModel(this.settings()));
  }

  private async save(): Promise<undefined> {
    this.serverError.set(null);
    try {
      const saved = await firstValueFrom(this.api.save(toSmtpInput(this.model())));
      this.smtpForm().reset();
      this.saved.emit(saved);
      toast.success('Email settings saved');
    } catch (error) {
      this.serverError.set(serverErrorMessage(error, 'Could not save the settings.'));
    }
    return undefined;
  }
}
