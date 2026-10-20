import { Component, computed, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCalendarRange } from '@ng-icons/lucide';
import type { BrnOverlayState } from '@spartan-ng/brain/overlay';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCalendarRange } from '@spartan-ng/helm/calendar';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmPopoverImports } from '@spartan-ng/helm/popover';
import { formatBucketRange } from '../models/chart-scale';
import { buildCustomRange, toTimeInput } from '../models/custom-range';
import { TimeWindow } from '../models/dashboard-filter';

/** Button + popover to pick an absolute window: a date range plus start and end times. */
@Component({
  selector: 'app-custom-range-picker',
  imports: [HlmPopoverImports, HlmButton, HlmCalendarRange, HlmInput, HlmLabel, NgIcon],
  providers: [provideIcons({ lucideCalendarRange })],
  template: `
    <hlm-popover
      align="start"
      sideOffset="4"
      [state]="state()"
      (stateChanged)="onStateChange($event)"
    >
      <button
        hlmPopoverTrigger
        hlmBtn
        variant="outline"
        size="sm"
        [class]="active() ? 'border-primary/50 bg-primary/5 dark:bg-primary/10' : ''"
        [attr.aria-label]="active() ? 'Custom range: ' + label() : 'Custom range'"
      >
        <ng-icon name="lucideCalendarRange" />
        {{ active() ? label() : 'Custom' }}
      </button>

      <hlm-popover-content class="w-auto gap-3 p-3" *hlmPopoverPortal="let ctx">
        <hlm-calendar-range
          [startDate]="startDay()"
          [endDate]="endDay()"
          [max]="today"
          (startDateChange)="startDay.set($event)"
          (endDateChange)="endDay.set($event)"
        />
        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1">
            <label hlmLabel for="range-start-time" class="text-xs">Start time</label>
            <input
              #start
              hlmInput
              id="range-start-time"
              type="time"
              class="h-8"
              [value]="startTime()"
              (input)="startTime.set(start.value)"
            />
          </div>
          <div class="grid gap-1">
            <label hlmLabel for="range-end-time" class="text-xs">End time</label>
            <input
              #end
              hlmInput
              id="range-end-time"
              type="time"
              class="h-8"
              [value]="endTime()"
              (input)="endTime.set(end.value)"
            />
          </div>
        </div>
        @if (error(); as error) {
          <p role="alert" class="text-destructive text-xs">{{ error }}</p>
        }
        <div class="flex justify-end gap-2">
          @if (active()) {
            <button hlmBtn variant="ghost" size="sm" class="me-auto" (click)="clear()">
              Use preset
            </button>
          }
          <button hlmBtn variant="outline" size="sm" (click)="state.set('closed')">Cancel</button>
          <button hlmBtn size="sm" (click)="apply()">Apply</button>
        </div>
      </hlm-popover-content>
    </hlm-popover>
  `,
})
export class CustomRangePicker {
  /** Current custom bounds (ISO); empty when a preset is active. */
  readonly from = input('');
  readonly to = input('');
  /** Window shown as the starting point when no custom range is active. */
  readonly fallback = input.required<TimeWindow>();
  readonly applied = output<{ from: string; to: string }>();
  readonly cleared = output();

  protected readonly today = new Date();
  protected readonly state = signal<BrnOverlayState | null>(null);
  protected readonly startDay = signal<Date | undefined>(undefined);
  protected readonly endDay = signal<Date | undefined>(undefined);
  protected readonly startTime = signal('00:00');
  protected readonly endTime = signal('00:00');
  protected readonly error = signal<string | null>(null);

  protected readonly active = computed(() => !!this.from() && !!this.to());
  protected readonly label = computed(() =>
    formatBucketRange(new Date(this.from()).getTime(), new Date(this.to()).getTime()),
  );

  protected onStateChange(state: BrnOverlayState): void {
    this.state.set(state);
    if (state === 'open') this.resetDraft();
  }

  protected apply(): void {
    const result = buildCustomRange(
      this.startDay(),
      this.startTime(),
      this.endDay(),
      this.endTime(),
    );
    if ('error' in result) {
      this.error.set(result.error);
      return;
    }
    this.applied.emit(result);
    this.state.set('closed');
  }

  protected clear(): void {
    this.cleared.emit();
    this.state.set('closed');
  }

  private resetDraft(): void {
    const from = this.active() ? new Date(this.from()) : this.fallback().from;
    const to = this.active() ? new Date(this.to()) : this.fallback().to;
    this.startDay.set(from);
    this.endDay.set(to);
    this.startTime.set(toTimeInput(from));
    this.endTime.set(toTimeInput(to));
    this.error.set(null);
  }
}
