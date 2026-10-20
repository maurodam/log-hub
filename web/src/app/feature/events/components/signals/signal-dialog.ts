import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../../../core/http/http-error';
import { ApiKeyLookup } from '../../../../shared/data-access/api-key-lookup';
import { SignalsApi } from '../../../../shared/data-access/signals.api';
import { FilterSpec } from '../../../../shared/models/filter-spec';
import { LogSignal, SignalInput } from '../../../../shared/models/signal';
import { describeFilterSpec } from '../../models/signal-filter';
import { normalizeGroupName } from '../../models/signal-groups';

export interface SignalDialogContext {
  /** Signal to edit; null creates a new one from `currentFilter`. */
  signal: LogSignal | null;
  /** FilterSpec built from the toolbar. */
  currentFilter: FilterSpec;
  /** Existing group names, suggested in the group field. */
  groupNames: readonly string[];
  /** Project permission: may create or change shared signals. */
  canShare: boolean;
}

interface SignalFormModel {
  title: string;
  description: string;
  groupName: string;
  isShared: boolean;
  /** Edit mode: replace the stored filter with the toolbar filter. */
  replaceFilter: boolean;
}

/** Create ("Save as signal") or edit a signal. Closes with the saved signal. */
@Component({
  selector: 'app-signal-dialog',
  imports: [
    HlmDialogImports,
    HlmButton,
    HlmCheckbox,
    HlmInput,
    HlmLabel,
    HlmSwitch,
    HlmTextarea,
    FormField,
  ],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ editing ? 'Edit signal' : 'Save as signal' }}</h2>
      <p hlmDialogDescription>
        @if (editing) {
          Change how this signal is named, grouped and shared.
        } @else {
          Save the current toolbar filters so you can apply them with one click.
        }
      </p>
    </hlm-dialog-header>

    <form class="grid gap-4" novalidate (submit)="save($event)">
      <div class="grid gap-1.5">
        <label hlmLabel for="signal-title">Title</label>
        <input
          hlmInput
          id="signal-title"
          autocomplete="off"
          placeholder="e.g. Billing errors"
          [formField]="signalForm.title"
          [attr.aria-invalid]="titleError() ? true : null"
          aria-describedby="signal-title-error"
        />
        @if (titleError(); as message) {
          <p id="signal-title-error" role="alert" class="text-destructive text-xs">{{ message }}</p>
        }
      </div>

      <div class="grid gap-1.5">
        <label hlmLabel for="signal-description">
          Description <span class="text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          hlmTextarea
          id="signal-description"
          rows="2"
          class="min-h-14"
          [formField]="signalForm.description"
        ></textarea>
      </div>

      <div class="grid gap-1.5">
        <label hlmLabel for="signal-group">
          Group <span class="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          hlmInput
          id="signal-group"
          autocomplete="off"
          list="signal-group-options"
          placeholder="Pick a group or type a new one"
          aria-describedby="signal-group-hint"
          [formField]="signalForm.groupName"
        />
        <datalist id="signal-group-options">
          @for (name of context.groupNames; track name) {
            <option [value]="name"></option>
          }
        </datalist>
        <p id="signal-group-hint" class="text-muted-foreground text-xs">
          Selected signals of the same group match any of them (OR); different groups must all match
          (AND).
        </p>
      </div>

      <fieldset class="grid gap-1.5">
        <legend class="mb-1.5 text-sm font-medium">Filter</legend>
        @if (shownFilter().length) {
          <ul class="bg-muted/40 flex flex-wrap gap-1.5 rounded-md border p-2">
            @for (part of shownFilter(); track $index) {
              <li class="bg-background rounded border px-1.5 py-0.5 font-mono text-xs">
                <span class="text-muted-foreground">{{ part.label }}</span> {{ part.value }}
              </li>
            }
          </ul>
        } @else {
          <p
            class="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300"
          >
            No filters set: this signal matches every event.
          </p>
        }
        @if (editing) {
          <div class="mt-1 flex items-center gap-2">
            <hlm-checkbox
              inputId="signal-replace-filter"
              [checked]="model().replaceFilter"
              (checkedChange)="patch({ replaceFilter: $event })"
            />
            <label hlmLabel for="signal-replace-filter" class="font-normal">
              Replace with the current toolbar filters
            </label>
          </div>
        } @else {
          <p class="text-muted-foreground text-xs">
            Time range and selected signals are not saved.
          </p>
        }
      </fieldset>

      @if (context.canShare) {
        <div class="flex items-start justify-between gap-4 rounded-md border p-3">
          <div class="grid gap-0.5">
            <label hlmLabel for="signal-shared">Shared</label>
            <p class="text-muted-foreground text-xs">Everyone on this server can use it.</p>
          </div>
          <hlm-switch
            inputId="signal-shared"
            [checked]="model().isShared"
            (checkedChange)="patch({ isShared: $event })"
          />
        </div>
      }

      @if (saveError(); as error) {
        <p role="alert" class="text-destructive text-sm">{{ error }}</p>
      }

      <hlm-dialog-footer>
        <button hlmBtn type="button" variant="outline" (click)="dialogRef.close()">Cancel</button>
        <button hlmBtn type="submit" [disabled]="saving()">
          {{ saving() ? 'Saving…' : editing ? 'Save changes' : 'Save signal' }}
        </button>
      </hlm-dialog-footer>
    </form>
  `,
})
export class SignalDialog {
  protected readonly context = injectBrnDialogContext<SignalDialogContext>();
  protected readonly dialogRef = inject<BrnDialogRef<LogSignal>>(BrnDialogRef);
  private readonly api = inject(SignalsApi);
  private readonly apiKeys = inject(ApiKeyLookup);

  protected readonly editing = this.context.signal !== null;

  protected readonly model = signal<SignalFormModel>({
    title: this.context.signal?.title ?? '',
    description: this.context.signal?.description ?? '',
    groupName: this.context.signal?.groupName ?? '',
    isShared: this.context.signal?.isShared ?? false,
    replaceFilter: false,
  });
  protected readonly signalForm = form(this.model, (path) => {
    required(path.title, { message: 'Enter a title.' });
    maxLength(path.title, 200, { message: 'Use at most 200 characters.' });
  });

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly titleError = computed(() => {
    const field = this.signalForm.title();
    return field.touched() && field.invalid() ? (field.errors()[0]?.message ?? null) : null;
  });

  /** FilterSpec that will be stored. */
  private readonly filter = computed<FilterSpec>(() => {
    const stored = this.context.signal?.filter;
    return stored && !this.model().replaceFilter ? stored : this.context.currentFilter;
  });
  protected readonly shownFilter = computed(() =>
    describeFilterSpec(this.filter(), (id) => this.apiKeys.titleOf(id)),
  );

  protected patch(change: Partial<SignalFormModel>): void {
    this.model.update((model) => ({ ...model, ...change }));
  }

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.signalForm, async () => {
      const model = this.model();
      const input: SignalInput = {
        title: model.title.trim(),
        description: model.description.trim() || null,
        groupName: normalizeGroupName(model.groupName),
        filter: this.filter(),
        isShared: this.context.canShare ? model.isShared : (this.context.signal?.isShared ?? false),
      };
      const existing = this.context.signal;
      this.saving.set(true);
      this.saveError.set(null);
      try {
        const saved = await firstValueFrom(
          existing ? this.api.update(existing.id, input) : this.api.create(input),
        );
        this.dialogRef.close(saved);
      } catch (error) {
        this.saveError.set(errorMessage(error) ?? 'The signal could not be saved.');
      } finally {
        this.saving.set(false);
      }
      return undefined;
    });
  }
}
