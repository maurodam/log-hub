import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { firstValueFrom } from 'rxjs';
import { Permission, PERMISSIONS, SessionService } from '../../../core/auth/session.service';
import { FieldError, showFieldError } from '../../../shared/components/field-error';
import { ApiKeysApi } from '../data-access/api-keys.api';
import {
  ApiKey,
  ApiKeyInput,
  CreatedApiKey,
  MINIMUM_LEVELS,
  MinimumLevel,
} from '../models/api-key';
import {
  propertiesToRows,
  PropertyRow,
  propertyRowsError,
  rowsToProperties,
} from '../models/applied-properties';
import { AppliedPropertiesEditor } from './applied-properties-editor';

export interface ApiKeyFormContext {
  /** Key to edit; null creates a new one. */
  apiKey: ApiKey | null;
}

export type ApiKeyFormResult =
  { kind: 'created'; created: CreatedApiKey } | { kind: 'updated'; apiKey: ApiKey };

const NO_LEVEL = 'none';

const PERMISSION_HINTS: Record<Permission, string> = {
  Ingest: 'Send events',
  Read: 'Search events and signals',
  Write: 'Create signals',
  Project: 'API keys, retention, alerts',
  Organization: 'Users and roles',
  System: 'Server settings',
};

/** Create / edit dialog for an API key. Saves itself and closes with the result. */
@Component({
  selector: 'app-api-key-form-dialog',
  imports: [
    AppliedPropertiesEditor,
    FieldError,
    FormField,
    HlmButton,
    HlmCheckbox,
    HlmDialogImports,
    HlmInput,
    HlmLabel,
    HlmSelectImports,
    HlmSpinner,
    HlmSwitch,
  ],
  host: { class: 'grid gap-4' },
  template: `
    <hlm-dialog-header>
      <h2 hlmDialogTitle>{{ editing ? 'Edit API key' : 'New API key' }}</h2>
      <p hlmDialogDescription>
        Applications send events with this key. Permissions, level and properties apply to every
        request made with it.
      </p>
    </hlm-dialog-header>

    <form
      id="api-key-form"
      class="-mx-4 grid max-h-[65vh] gap-5 overflow-y-auto px-4"
      novalidate
      (submit)="save($event)"
    >
      <div class="grid gap-1.5">
        <label hlmLabel for="ak-title">Title</label>
        <input
          hlmInput
          id="ak-title"
          autocomplete="off"
          placeholder="Billing service (production)"
          [formField]="keyForm.title"
          [forceInvalid]="invalid(keyForm.title)"
        />
        <app-field-error [field]="keyForm.title" />
      </div>

      <fieldset class="grid gap-2">
        <legend class="mb-2 text-sm font-medium">Permissions</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          @for (permission of permissions; track permission) {
            <div class="flex items-start gap-2" [class.opacity-60]="!canAssign(permission)">
              <hlm-checkbox
                class="mt-0.5"
                [inputId]="'ak-perm-' + permission"
                [checked]="selected().includes(permission)"
                [disabled]="!canAssign(permission)"
                (checkedChange)="toggle(permission, $event)"
              />
              <label [for]="'ak-perm-' + permission" class="grid gap-0.5 text-sm leading-tight">
                <span class="font-medium">{{ permission }}</span>
                <span class="text-muted-foreground text-xs">{{ hints[permission] }}</span>
              </label>
            </div>
          }
        </div>
        <p class="text-muted-foreground text-xs">
          You can only grant permissions you have yourself.
        </p>
      </fieldset>

      <div class="grid gap-1.5">
        <label hlmLabel for="ak-level">Minimum level</label>
        <hlm-select
          [value]="level()"
          (valueChange)="level.set($event ?? noLevel)"
          [itemToString]="levelLabel"
        >
          <hlm-select-trigger class="w-full" buttonId="ak-level">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            <hlm-select-item [value]="noLevel">None (accept all levels)</hlm-select-item>
            @for (option of levels; track option) {
              <hlm-select-item [value]="option">{{ option }}</hlm-select-item>
            }
          </hlm-select-content>
        </hlm-select>
        <p class="text-muted-foreground text-xs">
          Events below this level are dropped; the Seq sink also adopts it.
        </p>
      </div>

      <div class="grid gap-1.5">
        <span class="text-sm font-medium" id="ak-props-label">Applied properties</span>
        <app-applied-properties-editor aria-labelledby="ak-props-label" [(rows)]="properties" />
      </div>

      <div class="flex items-start justify-between gap-4">
        <label for="ak-server-time" class="grid gap-0.5 text-sm">
          <span class="font-medium">Use server timestamps</span>
          <span class="text-muted-foreground text-xs"
            >Replace the client timestamp with the arrival time.</span
          >
        </label>
        <hlm-switch
          inputId="ak-server-time"
          [checked]="useServerTimestamps()"
          (checkedChange)="useServerTimestamps.set($event)"
        />
      </div>
    </form>

    <hlm-dialog-footer>
      <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="cancel()">
        Cancel
      </button>
      <button hlmBtn type="submit" form="api-key-form" [disabled]="busy()">
        @if (busy()) {
          <hlm-spinner />
        }
        {{ editing ? 'Save changes' : 'Create key' }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class ApiKeyFormDialog {
  private readonly api = inject(ApiKeysApi);
  private readonly session = inject(SessionService);
  private readonly dialogRef = inject<BrnDialogRef<ApiKeyFormResult>>(BrnDialogRef);
  private readonly original = injectBrnDialogContext<ApiKeyFormContext>().apiKey;

  protected readonly editing = this.original !== null;
  protected readonly permissions = PERMISSIONS;
  protected readonly hints = PERMISSION_HINTS;
  protected readonly levels = MINIMUM_LEVELS;
  protected readonly noLevel = NO_LEVEL;
  protected readonly levelLabel = (value: string) =>
    value === NO_LEVEL ? 'None (accept all levels)' : value;

  protected readonly model = signal({ title: this.original?.title ?? '' });
  protected readonly keyForm = form(this.model, (path) => {
    required(path.title, { message: 'Enter a title.' });
    maxLength(path.title, 200, { message: 'Use at most 200 characters.' });
  });
  protected readonly selected = signal<Permission[]>(this.original?.permissions ?? ['Ingest']);
  protected readonly level = signal<string>(this.original?.minimumLevel ?? NO_LEVEL);
  protected readonly properties = signal<PropertyRow[]>(
    propertiesToRows(this.original?.appliedProperties),
  );
  protected readonly useServerTimestamps = signal(this.original?.useServerTimestamps ?? false);
  protected readonly busy = signal(false);

  private readonly propertiesValid = computed(() => propertyRowsError(this.properties()) === null);
  protected readonly invalid = showFieldError;

  protected canAssign(permission: Permission): boolean {
    return this.session.hasPermission(permission);
  }

  protected toggle(permission: Permission, checked: boolean): void {
    this.selected.update((current) => {
      const next = checked ? [...current, permission] : current.filter((p) => p !== permission);
      return PERMISSIONS.filter((p) => next.includes(p));
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    void submit(this.keyForm, async () => {
      if (!this.propertiesValid()) return undefined;
      this.busy.set(true);
      try {
        this.dialogRef.close(await this.persist(this.toInput()));
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

  private toInput(): ApiKeyInput {
    const level = this.level();
    return {
      title: this.model().title.trim(),
      permissions: this.selected(),
      minimumLevel: level === NO_LEVEL ? null : (level as MinimumLevel),
      appliedProperties: rowsToProperties(this.properties()),
      useServerTimestamps: this.useServerTimestamps(),
    };
  }

  private async persist(input: ApiKeyInput): Promise<ApiKeyFormResult> {
    if (this.original) {
      return {
        kind: 'updated',
        apiKey: await firstValueFrom(this.api.update(this.original.id, input)),
      };
    }
    return { kind: 'created', created: await firstValueFrom(this.api.create(input)) };
  }
}
