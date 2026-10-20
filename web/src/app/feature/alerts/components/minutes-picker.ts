import { Component, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { HlmInput } from '@spartan-ng/helm/input';
import { formatMinutes } from '../models/condition-summary';

/** Preset buttons plus a custom number of minutes. */
@Component({
  selector: 'app-minutes-picker',
  imports: [HlmInput],
  host: { class: 'flex flex-wrap items-center gap-1.5' },
  template: `
    <div class="flex flex-wrap gap-1" role="group" [attr.aria-label]="label() + ' presets'">
      @for (preset of presets(); track preset) {
        <button
          type="button"
          class="focus-visible:ring-ring/50 h-7 rounded-md border px-2 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
          [class]="
            value() === preset
              ? 'border-primary bg-primary text-primary-foreground'
              : 'hover:bg-muted border-border'
          "
          [attr.aria-pressed]="value() === preset"
          [disabled]="disabled()"
          (click)="value.set(preset); touch.emit()"
        >
          {{ preset === 0 && zeroLabel() ? zeroLabel() : formatMinutes(preset) }}
        </button>
      }
    </div>
    <label class="text-muted-foreground ms-1 flex items-center gap-1.5 text-xs">
      or
      <input
        #box
        hlmInput
        type="number"
        inputmode="numeric"
        step="1"
        class="h-7 w-20 font-mono text-xs"
        [attr.id]="inputId()"
        [attr.aria-label]="label() + ' in minutes'"
        [attr.aria-invalid]="(invalid() && touched()) || null"
        [disabled]="disabled()"
        [value]="value() ?? ''"
        (input)="onInput(box.value)"
        (blur)="touch.emit()"
      />
      min
    </label>
  `,
})
export class MinutesPicker implements FormValueControl<number | null> {
  readonly value = model<number | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly touch = output<void>();

  readonly presets = input.required<readonly number[]>();
  readonly label = input.required<string>();
  readonly inputId = input<string | null>(null);
  /** Button text for the 0 preset (e.g. "Off"). */
  readonly zeroLabel = input<string | null>(null);

  protected readonly formatMinutes = formatMinutes;

  protected onInput(text: string): void {
    this.value.set(text.trim() === '' ? null : Number(text));
  }
}
