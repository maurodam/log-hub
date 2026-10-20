import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { LEVEL_STYLES, LOG_LEVELS, LogLevel, normalizeLevels } from '../models/log-level';

const WARNING_AND_ABOVE: readonly LogLevel[] = ['Warning', 'Error', 'Fatal'];

/** Level multi-select. An empty selection means "all levels". */
@Component({
  selector: 'app-level-filter',
  imports: [HlmButton, HlmDropdownMenuImports, NgIcon],
  providers: [provideIcons({ lucideChevronDown })],
  template: `
    <button
      hlmBtn
      variant="outline"
      size="sm"
      align="start"
      [hlmDropdownMenuTrigger]="menu"
      [attr.aria-label]="'Levels: ' + label()"
    >
      @if (selected().length) {
        <span class="flex -space-x-0.5" aria-hidden="true">
          @for (level of selected(); track level) {
            <span
              class="ring-background size-2 rounded-full ring-2"
              [class]="styles[level].dot"
            ></span>
          }
        </span>
      }
      {{ label() }}
      <ng-icon name="lucideChevronDown" class="text-muted-foreground" />
    </button>

    <ng-template #menu>
      <hlm-dropdown-menu class="w-52">
        <hlm-dropdown-menu-label>Levels</hlm-dropdown-menu-label>
        @for (level of levels; track level) {
          <button
            hlmDropdownMenuCheckbox
            [checked]="effective().includes(level)"
            (triggered)="toggle(level)"
          >
            <span class="size-2 rounded-full" [class]="styles[level].dot"></span>
            {{ level }}
            <hlm-dropdown-menu-checkbox-indicator />
          </button>
        }
        <hlm-dropdown-menu-separator />
        <button hlmDropdownMenuItem (triggered)="selectedChange.emit(warningAndAbove)">
          Warning and above
        </button>
        <button hlmDropdownMenuItem (triggered)="selectedChange.emit([])">All levels</button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class LevelFilter {
  readonly selected = input.required<readonly LogLevel[]>();
  readonly selectedChange = output<readonly LogLevel[]>();

  protected readonly levels = LOG_LEVELS;
  protected readonly styles = LEVEL_STYLES;
  protected readonly warningAndAbove = WARNING_AND_ABOVE;

  /** Levels shown as checked: everything when no explicit selection exists. */
  protected readonly effective = computed<readonly LogLevel[]>(() =>
    this.selected().length ? this.selected() : LOG_LEVELS,
  );

  protected readonly label = computed(() => {
    const selected = this.selected();
    if (!selected.length) return 'All levels';
    return selected.length === 1 ? selected[0] : `${selected.length} levels`;
  });

  protected toggle(level: LogLevel): void {
    const current = this.effective();
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level];
    this.selectedChange.emit(normalizeLevels(next));
  }
}
