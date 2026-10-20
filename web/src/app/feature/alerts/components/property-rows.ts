import { Component, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlus, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { PropertyRow, propertyRowError } from '../models/alert-form';

/** Editable list of exact-match property filters (`Name=Value`). */
@Component({
  selector: 'app-property-rows',
  imports: [HlmButton, HlmInput, NgIcon],
  providers: [provideIcons({ lucidePlus, lucideX })],
  host: { class: 'grid gap-1.5' },
  template: `
    @for (row of value(); track $index; let i = $index) {
      @let error = rowError(row);
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5">
        <input
          #nameBox
          hlmInput
          class="h-7 font-mono text-xs"
          placeholder="Property"
          spellcheck="false"
          autocomplete="off"
          [attr.aria-label]="'Property name ' + (i + 1)"
          [attr.aria-invalid]="!!error || null"
          [disabled]="disabled()"
          [value]="row.name"
          (input)="update(i, { name: nameBox.value })"
          (blur)="touch.emit()"
        />
        <span class="text-muted-foreground font-mono text-xs" aria-hidden="true">=</span>
        <input
          #valueBox
          hlmInput
          class="h-7 font-mono text-xs"
          placeholder="Value"
          spellcheck="false"
          autocomplete="off"
          [attr.aria-label]="'Property value ' + (i + 1)"
          [disabled]="disabled()"
          [value]="row.value"
          (input)="update(i, { value: valueBox.value })"
          (blur)="touch.emit()"
        />
        <button
          hlmBtn
          type="button"
          variant="ghost"
          size="icon-sm"
          [attr.aria-label]="'Remove property filter ' + (i + 1)"
          [disabled]="disabled()"
          (click)="removeAt(i)"
        >
          <ng-icon name="lucideX" />
        </button>
        @if (error) {
          <p class="text-destructive col-span-4 text-xs" role="alert">{{ error }}</p>
        }
      </div>
    }
    <div class="flex items-center gap-3">
      <button
        hlmBtn
        type="button"
        variant="outline"
        size="xs"
        [disabled]="disabled()"
        (click)="add()"
      >
        <ng-icon name="lucidePlus" />
        Add property
      </button>
      @if (value().length) {
        <span class="text-muted-foreground text-xs">
          42, true and null match typed values; write "42" for the text 42.
        </span>
      }
    </div>
  `,
})
export class PropertyRows implements FormValueControl<PropertyRow[]> {
  readonly value = model<PropertyRow[]>([]);
  readonly disabled = input(false);
  readonly touch = output<void>();

  protected readonly rowError = propertyRowError;

  protected add(): void {
    this.value.update((rows) => [...rows, { name: '', value: '' }]);
  }

  protected removeAt(index: number): void {
    this.value.update((rows) => rows.filter((_, i) => i !== index));
    this.touch.emit();
  }

  protected update(index: number, change: Partial<PropertyRow>): void {
    this.value.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }
}
