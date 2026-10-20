import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { lucideChartColumnStacked, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { EmptyState } from '../../../shared/components/empty-state';
import { ApiKeyBreakdown } from '../components/api-key-breakdown';
import { DashboardToolbar } from '../components/dashboard-toolbar';
import { KpiTiles } from '../components/kpi-tiles';
import { LevelBreakdown } from '../components/level-breakdown';
import { TimelineChart } from '../components/timeline-chart';
import { TopEventTypes } from '../components/top-event-types';
import { DashboardStore } from '../data-access/dashboard-store';
import { formatBucketRange, formatDuration } from '../models/chart-scale';
import { eventsLinkParams, TimeWindow } from '../models/dashboard-filter';

@Component({
  selector: 'app-dashboard-page',
  imports: [
    ApiKeyBreakdown,
    DashboardToolbar,
    DatePipe,
    EmptyState,
    HlmButton,
    HlmSkeleton,
    KpiTiles,
    LevelBreakdown,
    NgTemplateOutlet,
    TimelineChart,
    TopEventTypes,
  ],
  providers: [DashboardStore, provideIcons({ lucideChartColumnStacked, lucideTriangleAlert })],
  host: { class: 'flex flex-col gap-3' },
  template: `
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 class="text-lg font-semibold tracking-tight">Overview</h2>
      @if (windowLabel(); as label) {
        <span class="text-muted-foreground text-xs tabular-nums">{{ label }}</span>
      }
      <span class="text-muted-foreground ms-auto text-xs tabular-nums" aria-live="polite">
        @if (store.refreshFailed()) {
          <span class="text-destructive">Refresh failed.</span>
          <button hlmBtn variant="link" size="xs" class="h-auto p-0" (click)="store.refresh()">
            Retry
          </button>
        } @else if (store.updatedAt(); as updatedAt) {
          Updated {{ updatedAt | date: 'HH:mm:ss' }}
        }
      </span>
    </div>

    <app-dashboard-toolbar />

    @if (store.state() === 'error') {
      <div class="bg-card flex min-h-80 rounded-lg border">
        <app-empty-state
          icon="lucideTriangleAlert"
          title="Could not load statistics"
          [description]="store.error() ?? undefined"
        >
          <button hlmBtn variant="outline" size="sm" class="mt-2" (click)="store.refresh()">
            Try again
          </button>
        </app-empty-state>
      </div>
    } @else {
      <app-kpi-tiles />

      <section class="bg-card rounded-lg border" aria-labelledby="dashboard-chart-title">
        <header class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3">
          <h3 id="dashboard-chart-title" class="text-sm font-semibold">Events over time</h3>
          @if (store.data()) {
            <span class="text-muted-foreground text-xs">
              {{ bucketLabel() }} per bar · click or drag to open events
            </span>
          }
          <ul class="text-muted-foreground ms-auto flex gap-3 text-xs" aria-label="Legend">
            <li class="flex items-center gap-1.5">
              <span class="size-2 rounded-sm bg-red-500 dark:bg-red-400"></span>Errors
            </li>
            <li class="flex items-center gap-1.5">
              <span class="size-2 rounded-sm bg-amber-500 dark:bg-amber-400"></span>Warnings
            </li>
            <li class="flex items-center gap-1.5">
              <span class="size-2 rounded-sm bg-sky-500/40 dark:bg-sky-400/35"></span>Other
            </li>
          </ul>
        </header>
        <div class="px-3 pt-2 pb-3">
          @if (store.data(); as data) {
            @if (data.total > 0) {
              <app-timeline-chart [data]="data" (rangeSelected)="openWindow($event)" />
            } @else {
              <app-empty-state
                class="h-56"
                icon="lucideChartColumnStacked"
                title="No events in this window"
                description="Try a longer time range or fewer filters."
              />
            }
          } @else {
            <hlm-skeleton class="h-56 w-full" />
          }
        </div>
      </section>

      <div class="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div class="grid content-start gap-3">
          <section class="bg-card rounded-lg border" aria-labelledby="dashboard-levels-title">
            <h3 id="dashboard-levels-title" class="px-4 pt-3 pb-1 text-sm font-semibold">Levels</h3>
            <div class="px-2 pb-2">
              @if (store.data()) {
                <app-level-breakdown />
              } @else {
                <ng-container [ngTemplateOutlet]="rowsSkeleton" />
              }
            </div>
          </section>
          <section class="bg-card rounded-lg border" aria-labelledby="dashboard-keys-title">
            <h3 id="dashboard-keys-title" class="px-4 pt-3 pb-1 text-sm font-semibold">
              Events by API key
            </h3>
            <div class="px-2 pb-2">
              @if (store.data()) {
                <app-api-key-breakdown />
              } @else {
                <ng-container [ngTemplateOutlet]="rowsSkeleton" />
              }
            </div>
          </section>
        </div>
        <section class="bg-card rounded-lg border" aria-labelledby="dashboard-types-title">
          <h3 id="dashboard-types-title" class="px-4 pt-3 pb-1 text-sm font-semibold">
            Top event types
          </h3>
          <div class="px-2 pb-2">
            @if (store.data()) {
              <app-top-event-types />
            } @else {
              <ng-container [ngTemplateOutlet]="rowsSkeleton" />
            }
          </div>
        </section>
      </div>
    }

    <ng-template #rowsSkeleton>
      <div class="grid gap-3 px-2 py-2" aria-hidden="true">
        @for (width of skeletonWidths; track $index) {
          <hlm-skeleton class="h-4" [style.width.%]="width" />
        }
      </div>
    </ng-template>
  `,
})
export class DashboardPage {
  protected readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  protected readonly skeletonWidths = [92, 74, 85, 61, 70];

  protected readonly windowLabel = computed(() => {
    const data = this.store.data();
    if (!data) return null;
    const from = new Date(data.from).getTime();
    const to = new Date(data.to).getTime();
    return Number.isFinite(from) && Number.isFinite(to) ? formatBucketRange(from, to) : null;
  });

  protected readonly bucketLabel = computed(() =>
    formatDuration(this.store.data()?.bucketSeconds ?? 0),
  );

  protected openWindow(window: TimeWindow): void {
    void this.router.navigate(['/events'], {
      queryParams: eventsLinkParams(this.store.filter(), {}, window),
    });
  }
}
