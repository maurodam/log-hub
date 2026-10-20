import { Component, computed, inject, Signal, signal } from '@angular/core';
import { form, FormField, FormRoot, required, validate } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBellRing, lucideX } from '@ng-icons/lucide';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { MultiSelect, MultiSelectOption } from '../../../shared/components/multi-select';
import { serverErrorMessage } from '../../../shared/utils/server-error';
import { Alert, AlertInput, LookupOption } from '../models/alert';
import {
  AlertDraft,
  draftFromAlert,
  draftToInput,
  emptyDraft,
  propertyRowError,
  SUPPRESSION_PRESETS,
  wholeNumberError,
  WINDOW_PRESETS,
} from '../models/alert-form';
import { conditionSummary, formatSuppression } from '../models/condition-summary';
import { recipientsError } from '../models/recipients';
import { LevelPicker } from './level-picker';
import { MinutesPicker } from './minutes-picker';
import { PropertyRows } from './property-rows';
import { RecipientsInput } from './recipients-input';

export interface AlertEditorContext {
  /** Alert to edit, or null to create one. */
  alert: Alert | null;
  signals: Signal<readonly LookupOption[]>;
  apiKeys: Signal<readonly LookupOption[]>;
  lookupsLoading: Signal<boolean>;
  save: (input: AlertInput) => Promise<Alert>;
}

const error = (kind: string, message: string | null) => (message ? { kind, message } : undefined);

/** Create/edit dialog for an alert. Closes with the saved alert. */
@Component({
  selector: 'app-alert-editor',
  imports: [
    FieldError,
    FormField,
    FormRoot,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmSelectImports,
    HlmSpinner,
    HlmSwitchImports,
    HlmTextarea,
    LevelPicker,
    MinutesPicker,
    MultiSelect,
    NgIcon,
    PropertyRows,
    RecipientsInput,
  ],
  providers: [provideIcons({ lucideBellRing, lucideX })],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ ctx.alert ? 'Edit alert' : 'New alert' }}</h2>
      <p hlmDialogDescription>
        LogHub checks every minute and emails the recipients when enough matching events arrive.
      </p>
    </hlm-dialog-header>

    <form [formRoot]="alertForm" class="grid gap-6">
      <section class="grid gap-3">
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-title">Title</label>
          <input
            hlmInput
            id="alert-title"
            autocomplete="off"
            placeholder="Payment errors"
            [formField]="alertForm.title"
            [attr.aria-invalid]="showError(alertForm.title) || null"
          />
          <app-field-error [field]="alertForm.title" />
        </div>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-description">
            Description <span class="text-muted-foreground font-normal">(optional)</span>
          </label>
          <textarea
            hlmTextarea
            id="alert-description"
            rows="2"
            class="min-h-14"
            placeholder="What the alert means and what to do when it fires"
            [formField]="alertForm.description"
          ></textarea>
        </div>
      </section>

      <section class="grid gap-3" aria-labelledby="alert-events-title">
        <h3
          id="alert-events-title"
          class="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Matching events
        </h3>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-signal">Signal</label>
          <div class="flex gap-1.5">
            <hlm-select
              class="flex-1"
              [formField]="alertForm.signalId"
              [itemToString]="signalTitle"
            >
              <hlm-select-trigger buttonId="alert-signal" class="w-full">
                <hlm-select-value placeholder="Any event (no signal)" />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (option of ctx.signals(); track option.id) {
                  <hlm-select-item [value]="option.id">{{ option.title }}</hlm-select-item>
                } @empty {
                  <p class="text-muted-foreground px-2 py-1.5 text-sm">No signals yet.</p>
                }
              </hlm-select-content>
            </hlm-select>
            @if (model().signalId !== null) {
              <button
                hlmBtn
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear signal"
                (click)="alertForm.signalId().value.set(null)"
              >
                <ng-icon name="lucideX" />
              </button>
            }
          </div>
        </div>

        <div class="grid gap-1.5">
          <label hlmLabel for="alert-text">Text contains</label>
          <input
            hlmInput
            id="alert-text"
            autocomplete="off"
            spellcheck="false"
            placeholder="e.g. timeout (message or exception)"
            [formField]="alertForm.text"
          />
        </div>

        <div class="grid gap-1.5">
          <span hlmLabel id="alert-levels-label">Levels</span>
          <app-level-picker aria-labelledby="alert-levels-label" [formField]="alertForm.levels" />
          <p class="text-muted-foreground text-xs">None selected means any level.</p>
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex items-center gap-2">
            <hlm-switch inputId="alert-exception" [formField]="alertForm.hasException" />
            <label hlmLabel for="alert-exception">Only events with an exception</label>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">API keys</span>
            <app-multi-select
              label="Any API key"
              searchPlaceholder="Search API keys…"
              emptyText="No API keys."
              [options]="apiKeyOptions()"
              [selected]="model().apiKeyIds"
              [loading]="ctx.lookupsLoading()"
              (selectedChange)="alertForm.apiKeyIds().value.set($event)"
            />
          </div>
        </div>

        <div class="grid gap-1.5">
          <span hlmLabel>Properties</span>
          <app-property-rows [formField]="alertForm.properties" />
        </div>
      </section>

      <section class="grid gap-3" aria-labelledby="alert-condition-title">
        <h3
          id="alert-condition-title"
          class="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Condition
        </h3>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-threshold">At least this many events</label>
          <input
            hlmInput
            id="alert-threshold"
            type="number"
            inputmode="numeric"
            step="1"
            class="w-28 font-mono"
            [formField]="alertForm.threshold"
            [attr.aria-invalid]="showError(alertForm.threshold) || null"
          />
          <app-field-error [field]="alertForm.threshold" />
        </div>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-window">Within the last</label>
          <app-minutes-picker
            inputId="alert-window"
            label="Window"
            [presets]="windowPresets"
            [formField]="alertForm.windowMinutes"
          />
          <app-field-error [field]="alertForm.windowMinutes" />
        </div>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-suppression">Then stay quiet for</label>
          <app-minutes-picker
            inputId="alert-suppression"
            label="Quiet period"
            zeroLabel="Don't wait"
            [presets]="suppressionPresets"
            [formField]="alertForm.suppressionMinutes"
          />
          <app-field-error [field]="alertForm.suppressionMinutes" />
        </div>
      </section>

      <section class="grid gap-3" aria-labelledby="alert-notify-title">
        <h3
          id="alert-notify-title"
          class="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
        >
          Notify
        </h3>
        <div class="grid gap-1.5">
          <label hlmLabel for="alert-recipients">Recipients</label>
          <app-recipients-input inputId="alert-recipients" [formField]="alertForm.recipients" />
          <app-field-error [field]="alertForm.recipients" />
        </div>
        <div class="flex items-center gap-2">
          <hlm-switch inputId="alert-enabled" [formField]="alertForm.isEnabled" />
          <label hlmLabel for="alert-enabled">Enabled</label>
        </div>
      </section>

      <div
        class="bg-muted/40 flex items-start gap-2 rounded-lg border p-3 text-sm"
        aria-live="polite"
      >
        <ng-icon name="lucideBellRing" class="text-muted-foreground mt-0.5 shrink-0" />
        <p>
          <span class="font-medium">{{ summary() }}</span>
          <span class="text-muted-foreground"> · notify {{ quiet() }}</span>
        </p>
      </div>

      @if (serverError(); as message) {
        <p class="text-destructive text-sm" role="alert">{{ message }}</p>
      }

      <hlm-dialog-footer class="bg-muted sticky -bottom-4 z-10">
        <button hlmBtn type="button" variant="outline" (click)="dialogRef.close()">Cancel</button>
        <button hlmBtn type="submit" [disabled]="alertForm().submitting()">
          @if (alertForm().submitting()) {
            <hlm-spinner />
          }
          {{ ctx.alert ? 'Save alert' : 'Create alert' }}
        </button>
      </hlm-dialog-footer>
    </form>
  `,
})
export class AlertEditor {
  protected readonly ctx = injectBrnDialogContext<AlertEditorContext>();
  protected readonly dialogRef = inject<BrnDialogRef<Alert>>(BrnDialogRef);
  protected readonly showError = showFieldError;
  protected readonly windowPresets = WINDOW_PRESETS;
  protected readonly suppressionPresets = SUPPRESSION_PRESETS;
  protected readonly serverError = signal<string | null>(null);

  protected readonly model = signal<AlertDraft>(
    this.ctx.alert ? draftFromAlert(this.ctx.alert) : emptyDraft(),
  );

  protected readonly alertForm = form(
    this.model,
    (path) => {
      required(path.title, { message: 'Enter a title.' });
      validate(path.threshold, ({ value }) =>
        error('threshold', wholeNumberError(value(), 1, 'The threshold')),
      );
      validate(path.windowMinutes, ({ value }) =>
        error('window', wholeNumberError(value(), 1, 'The window')),
      );
      validate(path.suppressionMinutes, ({ value }) =>
        error('suppression', wholeNumberError(value(), 0, 'The quiet period')),
      );
      validate(path.recipients, ({ value }) => error('recipients', recipientsError(value())));
      validate(path.properties, ({ value }) =>
        error('properties', value().map(propertyRowError).find(Boolean) ?? null),
      );
    },
    { submission: { action: () => this.save() } },
  );

  protected readonly apiKeyOptions = computed<MultiSelectOption[]>(() =>
    this.ctx.apiKeys().map((key) => ({ id: key.id, label: key.title })),
  );

  protected readonly signalTitle = (id: number | null) =>
    this.ctx.signals().find((option) => option.id === id)?.title ?? (id === null ? '' : `#${id}`);

  protected readonly summary = computed(() => {
    const input = draftToInput(this.model());
    return conditionSummary(input, {
      signal: input.signalId === null ? null : this.signalTitle(input.signalId),
      apiKey: (id) => this.ctx.apiKeys().find((key) => key.id === id)?.title,
    });
  });

  protected readonly quiet = computed(() =>
    formatSuppression(Math.max(0, this.model().suppressionMinutes ?? 0)),
  );

  private async save(): Promise<undefined> {
    this.serverError.set(null);
    try {
      this.dialogRef.close(await this.ctx.save(draftToInput(this.model())));
    } catch (failure) {
      this.serverError.set(serverErrorMessage(failure, 'Could not save the alert.'));
    }
    return undefined;
  }
}
