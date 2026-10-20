import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmRadioGroupImports } from '@spartan-ng/helm/radio-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { httpStatus, serverErrorMessage } from '../../../shared/utils/server-error';
import { RetentionPolicy, RetentionPolicyInput, SignalOption } from '../models/retention';
import {
  formatRetentionDays,
  isValidRetentionDays,
  RETENTION_PRESETS,
} from '../models/retention-format';

export interface PolicyDialogContext {
  /** Policy to edit, or null to create one. */
  policy: RetentionPolicy | null;
  signals: readonly SignalOption[];
  /** Id of the existing all-events policy (at most one may exist). */
  allEventsPolicyId: number | null;
  save: (input: RetentionPolicyInput) => Promise<RetentionPolicy>;
}

interface PolicyModel {
  target: 'all' | 'signal';
  signalId: number | null;
  retentionDays: number | null;
  isEnabled: boolean;
}

/** Create/edit dialog for one retention policy. Closes with the saved policy. */
@Component({
  selector: 'app-policy-dialog',
  imports: [
    FieldError,
    FormField,
    FormRoot,
    HlmAlertImports,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmRadioGroupImports,
    HlmSelectImports,
    HlmSpinner,
    HlmSwitchImports,
    NgIcon,
  ],
  providers: [provideIcons({ lucideTriangleAlert })],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ ctx.policy ? 'Edit retention policy' : 'New retention policy' }}</h2>
      <p hlmDialogDescription>Choose which events expire and how long LogHub keeps them.</p>
    </hlm-dialog-header>

    <form [formRoot]="policyForm" class="grid gap-5">
      <fieldset class="grid gap-2">
        <legend class="mb-2 text-sm font-medium">Applies to</legend>
        <hlm-radio-group [formField]="policyForm.target" class="gap-2">
          <label
            hlmLabel
            class="has-data-[checked=true]:border-primary has-data-[checked=true]:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <hlm-radio value="all" [disabled]="allEventsTaken">
              <hlm-radio-indicator indicator />
            </hlm-radio>
            <span class="grid gap-1">
              <span class="font-medium">All events</span>
              <span class="text-muted-foreground text-xs leading-snug">
                @if (allEventsTaken) {
                  An all-events policy already exists. Edit that one instead.
                } @else {
                  Drops whole days of data older than the period. Fast, frees disk space at once.
                }
              </span>
            </span>
          </label>
          <label
            hlmLabel
            class="has-data-[checked=true]:border-primary has-data-[checked=true]:bg-muted/40 flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal"
          >
            <hlm-radio value="signal">
              <hlm-radio-indicator indicator />
            </hlm-radio>
            <span class="grid gap-1">
              <span class="font-medium">Events matching a signal</span>
              <span class="text-muted-foreground text-xs leading-snug">
                Deletes only matching events, in batches. Use it to expire noisy events sooner.
              </span>
            </span>
          </label>
        </hlm-radio-group>
      </fieldset>

      @if (model().target === 'signal') {
        <div class="grid gap-2">
          <label hlmLabel for="policy-signal">Signal</label>
          @if (ctx.signals.length) {
            <hlm-select [formField]="policyForm.signalId" [itemToString]="signalTitle">
              <hlm-select-trigger buttonId="policy-signal" class="w-full">
                <hlm-select-value placeholder="Choose a signal" />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (option of ctx.signals; track option.id) {
                  <hlm-select-item [value]="option.id">{{ option.title }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          } @else {
            <p class="text-muted-foreground text-sm">
              No signals yet. Save a filter as a signal on the Events page first.
            </p>
          }
          <app-field-error [field]="policyForm.signalId" />
        </div>
      }

      <div class="grid gap-2">
        <label hlmLabel for="policy-days">Keep events for</label>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label="Retention presets">
          @for (preset of presets; track preset.days) {
            <button
              hlmBtn
              type="button"
              size="sm"
              [variant]="model().retentionDays === preset.days ? 'default' : 'outline'"
              [attr.aria-pressed]="model().retentionDays === preset.days"
              (click)="setDays(preset.days)"
            >
              {{ preset.label }}
            </button>
          }
        </div>
        <div class="flex items-center gap-2">
          <input
            hlmInput
            id="policy-days"
            type="number"
            step="1"
            inputmode="numeric"
            class="w-28 font-mono"
            [formField]="policyForm.retentionDays"
            [attr.aria-invalid]="showError(policyForm.retentionDays) || null"
            aria-describedby="policy-days-text"
          />
          <span class="text-sm">days</span>
          <span id="policy-days-text" class="text-muted-foreground text-xs">{{ daysText() }}</span>
        </div>
        <app-field-error [field]="policyForm.retentionDays" />
      </div>

      <div class="flex items-center gap-3">
        <hlm-switch inputId="policy-enabled" [formField]="policyForm.isEnabled" />
        <label hlmLabel for="policy-enabled">Enabled</label>
      </div>

      @if (model().isEnabled && daysText()) {
        <div hlmAlert>
          <ng-icon name="lucideTriangleAlert" class="text-amber-600 dark:text-amber-400" />
          <h3 hlmAlertTitle>Deletion is permanent</h3>
          <p hlmAlertDescription>
            {{ model().target === 'all' ? 'Events' : 'Matching events' }} older than
            {{ daysText() }} will be permanently deleted on the next run (hourly).
          </p>
        </div>
      }

      @if (serverError(); as message) {
        <p class="text-destructive text-sm" role="alert">{{ message }}</p>
      }

      <hlm-dialog-footer>
        <button hlmBtn type="button" variant="outline" (click)="dialogRef.close()">Cancel</button>
        <button hlmBtn type="submit" [disabled]="policyForm().submitting()">
          @if (policyForm().submitting()) {
            <hlm-spinner />
          }
          {{ ctx.policy ? 'Save' : 'Create policy' }}
        </button>
      </hlm-dialog-footer>
    </form>
  `,
})
export class PolicyDialog {
  protected readonly ctx = injectBrnDialogContext<PolicyDialogContext>();
  protected readonly dialogRef = inject<BrnDialogRef<RetentionPolicy>>(BrnDialogRef);
  protected readonly presets = RETENTION_PRESETS;
  protected readonly showError = showFieldError;
  protected readonly serverError = signal<string | null>(null);

  /** Another policy already covers all events (the server allows only one). */
  protected readonly allEventsTaken =
    this.ctx.allEventsPolicyId !== null && this.ctx.allEventsPolicyId !== this.ctx.policy?.id;

  protected readonly model = signal<PolicyModel>(this.initialModel());

  protected readonly policyForm = form(
    this.model,
    (path) => {
      required(path.signalId, {
        message: 'Choose a signal.',
        when: ({ valueOf }) => valueOf(path.target) === 'signal',
      });
      validate(path.retentionDays, ({ value }) =>
        isValidRetentionDays(value())
          ? undefined
          : { kind: 'days', message: 'Enter a whole number of days, 1 or more.' },
      );
    },
    { submission: { action: () => this.save() } },
  );

  protected readonly daysText = computed(() => {
    const days = this.model().retentionDays;
    return isValidRetentionDays(days) ? formatRetentionDays(days) : '';
  });

  protected readonly signalTitle = (id: number | null) =>
    this.ctx.signals.find((option) => option.id === id)?.title ?? '';

  protected setDays(days: number): void {
    this.policyForm.retentionDays().value.set(days);
  }

  private initialModel(): PolicyModel {
    const policy = this.ctx.policy;
    if (policy) {
      return {
        target: policy.signalId === null ? 'all' : 'signal',
        signalId: policy.signalId,
        retentionDays: policy.retentionDays,
        isEnabled: policy.isEnabled,
      };
    }
    return {
      target: this.allEventsTaken ? 'signal' : 'all',
      signalId: null,
      retentionDays: 30,
      isEnabled: true,
    };
  }

  private async save(): Promise<undefined> {
    this.serverError.set(null);
    const { target, signalId, retentionDays, isEnabled } = this.model();
    const input: RetentionPolicyInput = {
      signalId: target === 'all' ? null : signalId,
      retentionDays: retentionDays ?? 0,
      isEnabled,
    };
    try {
      this.dialogRef.close(await this.ctx.save(input));
    } catch (error) {
      this.serverError.set(
        httpStatus(error) === 409
          ? 'An all-events policy already exists'
          : serverErrorMessage(error, 'Could not save the policy.'),
      );
    }
    return undefined;
  }
}
