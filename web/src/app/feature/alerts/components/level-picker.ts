import { Component, input, model, output } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { ALERT_LEVEL_DOT, ALERT_LEVELS, AlertLevel, normalizeLevels } from '../models/alert-levels';

/** Toggle buttons for event levels. An empty selection means "any level". */
@Component({
  selector: 'app-level-picker',
  host: { class: 'flex flex-wrap gap-1', role: 'group' },
  template: `
    @for (level of levels; track level) {
      @let on = value().includes(level);
      <button
        type="button"
        class="focus-visible:ring-ring/50 inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-3 disabled:opacity-50"
        [class]="
          on
            ? 'border-foreground/30 bg-foreground/5 text-foreground'
            : 'text-muted-foreground hover:bg-muted border-transparent'
        "
        [attr.aria-pressed]="on"
        [disabled]="disabled()"
        (click)="toggle(level)"
        (blur)="touch.emit()"
      >
        <span class="size-2 rounded-full" [class]="dots[level]" aria-hidden="true"></span>
        {{ level }}
      </button>
    }
  `,
})
export class LevelPicker implements FormValueControl<AlertLevel[]> {
  readonly value = model<AlertLevel[]>([]);
  readonly disabled = input(false);
  readonly touch = output<void>();

  protected readonly levels = ALERT_LEVELS;
  protected readonly dots = ALERT_LEVEL_DOT;

  protected toggle(level: AlertLevel): void {
    const current = this.value();
    this.value.set(
      normalizeLevels(
        current.includes(level) ? current.filter((item) => item !== level) : [...current, level],
      ),
    );
  }
}
