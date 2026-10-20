import { Component, inject, input, signal } from '@angular/core';
import { email, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSend } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../../core/auth/session.service';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { serverErrorMessage } from '../../../shared/utils/server-error';
import { SmtpApi } from '../data-access/smtp.api';

/** Sends a test email with the saved SMTP settings; shows the SMTP error inline (502). */
@Component({
  selector: 'app-test-email-card',
  imports: [
    FieldError,
    FormField,
    FormRoot,
    HlmButton,
    HlmCardImports,
    HlmInput,
    HlmLabel,
    HlmSpinner,
    NgIcon,
  ],
  providers: [provideIcons({ lucideSend })],
  template: `
    <form hlmCard [formRoot]="testForm" aria-labelledby="test-email-title">
      <div hlmCardHeader>
        <h3 hlmCardTitle id="test-email-title">Send a test email</h3>
        <p hlmCardDescription>
          Uses the saved settings.
          @if (!configured()) {
            Save a working SMTP server first.
          }
        </p>
      </div>
      <div hlmCardContent class="grid gap-3">
        <div class="grid gap-1.5">
          <label hlmLabel for="test-email-to">Recipient</label>
          <div class="flex gap-2">
            <input
              hlmInput
              id="test-email-to"
              type="email"
              autocomplete="email"
              spellcheck="false"
              placeholder="you@example.com"
              [formField]="testForm.to"
              [attr.aria-invalid]="showError(testForm.to) || null"
            />
            <button hlmBtn type="submit" [disabled]="!configured() || testForm().submitting()">
              @if (testForm().submitting()) {
                <hlm-spinner />
              } @else {
                <ng-icon name="lucideSend" />
              }
              Send
            </button>
          </div>
          <app-field-error [field]="testForm.to" />
        </div>
        @if (error(); as message) {
          <div
            class="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm"
            role="alert"
          >
            <p class="font-medium">Sending failed</p>
            <p class="mt-1 font-mono text-xs break-words whitespace-pre-wrap">{{ message }}</p>
          </div>
        }
      </div>
    </form>
  `,
})
export class TestEmailCard {
  /** SMTP settings are saved and complete. */
  readonly configured = input(false);

  private readonly api = inject(SmtpApi);
  protected readonly showError = showFieldError;
  protected readonly error = signal<string | null>(null);

  protected readonly model = signal({ to: inject(SessionService).user()?.email ?? '' });
  protected readonly testForm = form(
    this.model,
    (path) => {
      required(path.to, { message: 'Enter a recipient.' });
      email(path.to, { message: 'Enter a valid email address.' });
    },
    { submission: { action: () => this.send() } },
  );

  private async send(): Promise<undefined> {
    this.error.set(null);
    const to = this.model().to.trim();
    try {
      await firstValueFrom(this.api.sendTest(to));
      toast.success(`Test email sent to ${to}`);
    } catch (error) {
      this.error.set(serverErrorMessage(error, 'The SMTP server did not accept the message.'));
    }
    return undefined;
  }
}
