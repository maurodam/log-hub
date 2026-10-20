import { Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBug, lucideChevronRight } from '@ng-icons/lucide';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { displayMessage, LogEvent } from '../models/log-event';
import { LEVEL_STYLES, levelFromRank } from '../models/log-level';
import { LevelBadge } from './level-badge';

/** Single-line summary of an event. Clicking it toggles the detail panel. */
@Component({
  selector: 'app-event-row',
  imports: [LevelBadge, LocalTimePipe, NgIcon],
  providers: [provideIcons({ lucideBug, lucideChevronRight })],
  template: `
    <button
      type="button"
      class="hover:bg-muted/70 focus-visible:bg-muted focus-visible:ring-ring/60 grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      [class]="rowTint()"
      [class.bg-muted]="expanded()"
      [attr.id]="'event-row-' + event().id"
      [attr.aria-expanded]="expanded()"
      [attr.aria-controls]="expanded() ? 'event-detail-' + event().id : null"
      (click)="toggled.emit()"
    >
      <app-level-badge [rank]="event().levelRank" [label]="event().level" />
      <time
        class="text-muted-foreground font-mono text-xs tabular-nums"
        [attr.datetime]="event().timestamp"
        >{{ event().timestamp | localTime }}</time
      >
      <span class="truncate text-[13px]">{{ message() }}</span>
      <span class="text-muted-foreground flex items-center gap-1.5">
        @if (event().exception) {
          <ng-icon
            name="lucideBug"
            class="text-red-600 dark:text-red-400"
            aria-label="Has exception"
            role="img"
          />
        }
        <ng-icon
          name="lucideChevronRight"
          class="transition-transform"
          [class.rotate-90]="expanded()"
          aria-hidden="true"
        />
      </span>
    </button>
  `,
})
export class EventRow {
  readonly event = input.required<LogEvent>();
  readonly expanded = input(false);
  readonly toggled = output();

  protected readonly message = computed(() => displayMessage(this.event()));
  protected readonly rowTint = computed(
    () => LEVEL_STYLES[levelFromRank(this.event().levelRank)].row,
  );
}
