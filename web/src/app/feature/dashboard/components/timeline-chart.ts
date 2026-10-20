import { DecimalPipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  bucketAt,
  formatBucketRange,
  formatCompact,
  formatTimeTick,
  linearTicks,
  timeTicks,
  timeTickStep,
} from '../models/chart-scale';
import { TimeWindow } from '../models/dashboard-filter';
import { StatsOverview } from '../models/stats';

const HEIGHT = 224;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 44 } as const;
/** Minimum horizontal room per x axis label. */
const LABEL_SPACING = 84;

interface Bar {
  index: number;
  x: number;
  width: number;
  errors: { y: number; height: number };
  warnings: { y: number; height: number };
  other: { y: number; height: number };
}

interface BucketInfo {
  index: number;
  start: number;
  end: number;
  total: number;
  errors: number;
  warnings: number;
  other: number;
}

/**
 * Stacked bar chart of events per bucket (errors, warnings, everything else) drawn as plain SVG.
 * Hover shows the counts; click a bar or drag across several to open them in the events list.
 * Keyboard: arrow keys move between buckets, Enter opens the focused one.
 */
@Component({
  selector: 'app-timeline-chart',
  imports: [DecimalPipe],
  host: { class: 'block' },
  template: `
    <div
      #frame
      class="focus-visible:ring-ring/60 relative w-full touch-none rounded-md outline-none select-none focus-visible:ring-2"
      tabindex="0"
      role="group"
      aria-roledescription="chart"
      [attr.aria-label]="summary()"
      [style.height.px]="height"
      (pointerleave)="onPointerLeave()"
      (keydown)="onKeydown($event)"
      (blur)="hover.set(null)"
    >
      @if (width() > 0) {
        <svg
          class="absolute inset-0 block cursor-crosshair"
          [attr.width]="width()"
          [attr.height]="height"
          [attr.viewBox]="'0 0 ' + width() + ' ' + height"
          aria-hidden="true"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="drag.set(null)"
        >
          @for (tick of yAxis().ticks; track tick) {
            <line
              class="stroke-border"
              [attr.x1]="margin.left"
              [attr.x2]="width() - margin.right"
              [attr.y1]="y(tick)"
              [attr.y2]="y(tick)"
              [attr.stroke-dasharray]="tick === 0 ? null : '2 4'"
            />
            <text
              class="fill-muted-foreground text-[10px] tabular-nums"
              text-anchor="end"
              dominant-baseline="middle"
              [attr.x]="margin.left - 8"
              [attr.y]="y(tick)"
            >
              {{ compact(tick) }}
            </text>
          }

          @if (band(); as band) {
            <rect
              [class]="drag() ? 'fill-primary/10 stroke-primary/40' : 'fill-foreground/[0.06]'"
              [attr.x]="band.x"
              [attr.y]="margin.top"
              [attr.width]="band.width"
              [attr.height]="plotHeight()"
              rx="2"
            />
          }

          @for (bar of bars(); track bar.index) {
            <g>
              <rect
                class="fill-sky-500/40 dark:fill-sky-400/35"
                [attr.x]="bar.x"
                [attr.y]="bar.other.y"
                [attr.width]="bar.width"
                [attr.height]="bar.other.height"
              />
              <rect
                class="fill-amber-500 dark:fill-amber-400"
                [attr.x]="bar.x"
                [attr.y]="bar.warnings.y"
                [attr.width]="bar.width"
                [attr.height]="bar.warnings.height"
              />
              <rect
                class="fill-red-500 dark:fill-red-400"
                [attr.x]="bar.x"
                [attr.y]="bar.errors.y"
                [attr.width]="bar.width"
                [attr.height]="bar.errors.height"
              />
            </g>
          }

          @for (tick of xTicks(); track tick.ms) {
            <line
              class="stroke-border"
              [attr.x1]="tick.x"
              [attr.x2]="tick.x"
              [attr.y1]="height - margin.bottom"
              [attr.y2]="height - margin.bottom + 4"
            />
            <text
              class="fill-muted-foreground text-[10px] tabular-nums"
              text-anchor="middle"
              [attr.x]="tick.x"
              [attr.y]="height - 6"
            >
              {{ tick.label }}
            </text>
          }
        </svg>
      }

      @if (hovered(); as info) {
        <div
          class="bg-popover text-popover-foreground ring-foreground/10 pointer-events-none absolute top-0 z-10 w-52 -translate-x-1/2 rounded-md px-3 py-2 text-xs shadow-md ring-1"
          [style.left.px]="tooltipX()"
        >
          <p class="mb-1.5 font-medium tabular-nums">{{ info.title }}</p>
          <dl class="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 tabular-nums">
            <span class="size-2 rounded-sm bg-red-500 dark:bg-red-400"></span>
            <dt class="text-muted-foreground">Errors</dt>
            <dd class="text-end">{{ info.errors | number }}</dd>
            <span class="size-2 rounded-sm bg-amber-500 dark:bg-amber-400"></span>
            <dt class="text-muted-foreground">Warnings</dt>
            <dd class="text-end">{{ info.warnings | number }}</dd>
            <span class="size-2 rounded-sm bg-sky-500/40 dark:bg-sky-400/35"></span>
            <dt class="text-muted-foreground">Other</dt>
            <dd class="text-end">{{ info.other | number }}</dd>
            <span></span>
            <dt class="font-medium">Total</dt>
            <dd class="text-end font-medium">{{ info.total | number }}</dd>
          </dl>
          <p class="text-muted-foreground mt-1.5">
            {{ drag() ? 'Release to open this range' : 'Click to open these events' }}
          </p>
        </div>
      }
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>
  `,
})
export class TimelineChart {
  readonly data = input.required<StatsOverview>();
  /** Emits the window of the clicked bucket or of the dragged range. */
  readonly rangeSelected = output<TimeWindow>();

  private readonly frame = viewChild.required<ElementRef<HTMLDivElement>>('frame');

  protected readonly height = HEIGHT;
  protected readonly margin = MARGIN;
  protected readonly compact = formatCompact;

  protected readonly width = signal(0);
  protected readonly hover = signal<number | null>(null);
  /** Bucket indexes of a drag in progress. */
  protected readonly drag = signal<{ start: number; end: number } | null>(null);
  /** True while the keyboard (not the mouse) moves the hover, to announce buckets. */
  private readonly keyboard = signal(false);

  protected readonly plotWidth = computed(() =>
    Math.max(0, this.width() - MARGIN.left - MARGIN.right),
  );
  protected readonly plotHeight = computed(() => HEIGHT - MARGIN.top - MARGIN.bottom);
  private readonly count = computed(() => this.data().series.length);
  private readonly step = computed(() => (this.count() ? this.plotWidth() / this.count() : 0));

  protected readonly yAxis = computed(() =>
    linearTicks(Math.max(0, ...this.data().series.map((bucket) => bucket.total)), 4),
  );

  private readonly buckets = computed<BucketInfo[]>(() => {
    const data = this.data();
    const bucketMs = data.bucketSeconds * 1000;
    const windowEnd = new Date(data.to).getTime();
    return data.series.map((bucket, index) => {
      const start = new Date(bucket.start).getTime();
      const errors = Math.max(0, bucket.errors);
      const warnings = Math.max(0, bucket.warnings);
      return {
        index,
        start,
        end: Number.isFinite(windowEnd) ? Math.min(start + bucketMs, windowEnd) : start + bucketMs,
        total: bucket.total,
        errors,
        warnings,
        other: Math.max(0, bucket.total - errors - warnings),
      };
    });
  });

  protected readonly bars = computed<Bar[]>(() => {
    const step = this.step();
    const gap = step >= 6 ? Math.min(6, step * 0.2) : 0;
    const width = Math.max(1, step - gap);
    return this.buckets().map((bucket) => {
      const x = MARGIN.left + bucket.index * step + gap / 2;
      let top = this.y(0);
      const segment = (value: number) => {
        const height = this.y(0) - this.y(value);
        top -= height;
        return { y: top, height };
      };
      // Stacked bottom-up: errors first, so they always start at the baseline.
      const errors = segment(bucket.errors);
      const warnings = segment(bucket.warnings);
      const other = segment(bucket.other);
      return { index: bucket.index, x, width, errors, warnings, other };
    });
  });

  protected readonly xTicks = computed(() => {
    const buckets = this.buckets();
    if (!buckets.length || this.plotWidth() <= 0) return [];
    const from = buckets[0].start;
    const to = buckets[buckets.length - 1].end;
    const maxTicks = Math.max(2, Math.floor(this.plotWidth() / LABEL_SPACING));
    const step = timeTickStep(to - from, maxTicks);
    return timeTicks(from, to, maxTicks).map((ms) => ({
      ms,
      x: MARGIN.left + ((ms - from) / (to - from)) * this.plotWidth(),
      label: formatTimeTick(ms, step),
    }));
  });

  /** Highlighted area: the dragged range, or the hovered bucket. */
  protected readonly band = computed(() => {
    const drag = this.drag();
    const hover = this.hover();
    const step = this.step();
    if (drag) {
      const first = Math.min(drag.start, drag.end);
      const last = Math.max(drag.start, drag.end);
      return { x: MARGIN.left + first * step, width: (last - first + 1) * step };
    }
    return hover === null ? null : { x: MARGIN.left + hover * step, width: step };
  });

  protected readonly hovered = computed(() => {
    const drag = this.drag();
    const buckets = this.buckets();
    if (drag && drag.start !== drag.end) {
      const selected = buckets.slice(
        Math.min(drag.start, drag.end),
        Math.max(drag.start, drag.end) + 1,
      );
      return summarize(selected);
    }
    const index = this.hover();
    const bucket = index === null ? undefined : buckets[index];
    return bucket ? summarize([bucket]) : null;
  });

  protected readonly tooltipX = computed(() => {
    const band = this.band();
    if (!band) return 0;
    const half = 104; // half the tooltip width (w-52)
    return Math.min(Math.max(band.x + band.width / 2, half), Math.max(half, this.width() - half));
  });

  protected readonly summary = computed(() => {
    const data = this.data();
    const minutes = Math.round(data.bucketSeconds / 60);
    return `Events over time: ${data.series.length} bars of ${minutes} min, ${data.total} events in total. Use the arrow keys to read bars and Enter to open one.`;
  });

  protected readonly announcement = computed(() => {
    const info = this.hovered();
    if (!this.keyboard() || !info) return '';
    return `${info.title}: ${info.total} events, ${info.errors} errors, ${info.warnings} warnings.`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.frame().nativeElement;
      this.width.set(element.clientWidth);
      const observer = new ResizeObserver((entries) => {
        const width = Math.floor(entries[0]?.contentRect.width ?? 0);
        if (width !== this.width()) this.width.set(width);
      });
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected y(value: number): number {
    return MARGIN.top + this.plotHeight() - (value / this.yAxis().max) * this.plotHeight();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const index = this.indexAt(event);
    if (index === null) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.keyboard.set(false);
    this.drag.set({ start: index, end: index });
    this.hover.set(index);
  }

  protected onPointerMove(event: PointerEvent): void {
    const index = this.indexAt(event);
    const drag = this.drag();
    this.keyboard.set(false);
    if (drag) {
      if (index !== null) this.drag.set({ ...drag, end: index });
      return;
    }
    this.hover.set(index);
  }

  protected onPointerUp(event: PointerEvent): void {
    const drag = this.drag();
    if (!drag) return;
    (event.currentTarget as Element).releasePointerCapture(event.pointerId);
    this.drag.set(null);
    this.open(Math.min(drag.start, drag.end), Math.max(drag.start, drag.end));
  }

  protected onPointerLeave(): void {
    if (!this.drag()) this.hover.set(null);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.count();
    if (!count) return;
    const current = this.hover();
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = current === null ? 0 : Math.min(count - 1, current + 1);
        break;
      case 'ArrowLeft':
        next = current === null ? count - 1 : Math.max(0, current - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Enter':
      case ' ':
        if (current !== null) {
          event.preventDefault();
          this.open(current, current);
        }
        return;
      case 'Escape':
        if (current !== null) {
          event.preventDefault();
          this.hover.set(null);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    this.keyboard.set(true);
    this.hover.set(next);
  }

  private open(first: number, last: number): void {
    const buckets = this.buckets();
    const start = buckets[first];
    const end = buckets[last];
    if (!start || !end) return;
    this.rangeSelected.emit({ from: new Date(start.start), to: new Date(end.end) });
  }

  private indexAt(event: PointerEvent): number | null {
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    return bucketAt(event.clientX - rect.left - MARGIN.left, this.plotWidth(), this.count());
  }
}

function summarize(buckets: readonly BucketInfo[]) {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const sum = (pick: (bucket: BucketInfo) => number) =>
    buckets.reduce((total, bucket) => total + pick(bucket), 0);
  return {
    title: formatBucketRange(first.start, last.end),
    total: sum((b) => b.total),
    errors: sum((b) => b.errors),
    warnings: sum((b) => b.warnings),
    other: sum((b) => b.other),
  };
}
