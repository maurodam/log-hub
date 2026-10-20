import { Component, computed, model } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { PropertyRow, propertyRowsError } from '../models/applied-properties';

/** Name/value rows added to every event ingested with the key. */
@Component({
  selector: 'app-applied-properties-editor',
  imports: [HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucidePlus, lucideX })],
  host: { class: 'grid gap-2' },
  template: `
    @if (rows().length) {
      <div
        class="text-muted-foreground grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium"
        aria-hidden="true"
      >
        <span>Name</span>
        <span>Value</span>
        <span class="w-7"></span>
      </div>
    }
    @for (row of rows(); track $index; let i = $index) {
      <div class="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
        <input
          #keyBox
          hlmInput
          class="h-7 font-mono text-xs"
          placeholder="Application"
          spellcheck="false"
          autocomplete="off"
          [attr.aria-label]="'Property ' + (i + 1) + ' name'"
          [value]="row.key"
          (input)="update(i, { key: keyBox.value })"
        />
        <input
          #valueBox
          hlmInput
          class="h-7 font-mono text-xs"
          placeholder="Billing"
          spellcheck="false"
          autocomplete="off"
          [attr.aria-label]="'Property ' + (i + 1) + ' value'"
          [value]="row.value"
          (input)="update(i, { value: valueBox.value })"
        />
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon-sm"
          [attr.aria-label]="'Remove property ' + (row.key || i + 1)"
          (click)="remove(i)"
        >
          <ng-icon name="lucideX" />
        </button>
      </div>
    }
    @if (error(); as error) {
      <p role="alert" class="text-destructive text-xs">{{ error }}</p>
    }
    <div class="flex items-center justify-between gap-2">
      <button hlmBtn type="button" variant="outline" size="xs" (click)="add()">
        <ng-icon name="lucidePlus" />
        Add property
      </button>
      @if (rows().length) {
        <span class="text-muted-foreground text-xs"
          >Values like 42, true or null keep their type; quote to force text.</span
        >
      }
    </div>
  `,
})
export class AppliedPropertiesEditor {
  readonly rows = model.required<PropertyRow[]>();

  protected readonly error = computed(() => propertyRowsError(this.rows()));

  protected add(): void {
    this.rows.update((rows) => [...rows, { key: '', value: '' }]);
  }

  protected remove(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected update(index: number, change: Partial<PropertyRow>): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }
}
