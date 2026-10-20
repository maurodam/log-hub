import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { EventFilter, QueryValues } from '../../events/models/event-filter';
import { DashboardStore } from '../data-access/dashboard-store';
import { eventsLinkParams } from '../models/dashboard-filter';
import { percentOf, StatsOverview } from '../models/stats';

interface Tile {
  id: string;
  label: string;
  value: number;
  /** Secondary line, e.g. share of all events. */
  note: string;
  accent: string;
  link: QueryValues;
}

interface TileSpec {
  id: string;
  label: string;
  accent: string;
  value: (data: StatsOverview) => number;
  extra: Partial<EventFilter>;
  share: boolean;
}

// Full class strings so the Tailwind scanner sees them.
const TILES: readonly TileSpec[] = [
  {
    id: 'total',
    label: 'Events',
    accent: 'bg-sky-500',
    value: (d) => d.total,
    extra: {},
    share: false,
  },
  {
    id: 'errors',
    label: 'Errors',
    accent: 'bg-red-500',
    value: (d) => d.errors,
    extra: { levels: ['Error', 'Fatal'] },
    share: true,
  },
  {
    id: 'warnings',
    label: 'Warnings',
    accent: 'bg-amber-500',
    value: (d) => d.warnings,
    extra: { levels: ['Warning'] },
    share: true,
  },
  {
    id: 'exceptions',
    label: 'Exceptions',
    accent: 'bg-fuchsia-600',
    value: (d) => d.exceptions,
    extra: { hasException: true },
    share: true,
  },
  {
    id: 'types',
    label: 'Event types',
    accent: 'bg-zinc-400',
    value: (d) => d.distinctEventTypes,
    extra: {},
    share: false,
  },
];

/** Headline counters. Each tile opens the matching events (same window and filters). */
@Component({
  selector: 'app-kpi-tiles',
  imports: [DecimalPipe, HlmSkeleton, RouterLink],
  host: { class: 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5' },
  template: `
    @if (tiles(); as tiles) {
      @for (tile of tiles; track tile.id) {
        <a
          routerLink="/events"
          [queryParams]="tile.link"
          class="bg-card hover:border-foreground/20 focus-visible:ring-ring/60 group relative flex flex-col gap-1 overflow-hidden rounded-lg border px-4 py-3 outline-none focus-visible:ring-2"
          [attr.aria-label]="tile.label + ': ' + (tile.value | number) + '. Open matching events.'"
        >
          <span
            class="absolute inset-y-0 start-0 w-1"
            [class]="tile.accent"
            aria-hidden="true"
          ></span>
          <span class="text-muted-foreground text-xs font-medium">{{ tile.label }}</span>
          <span class="text-2xl font-semibold tracking-tight tabular-nums">{{
            tile.value | number
          }}</span>
          <span class="text-muted-foreground group-hover:text-foreground text-xs tabular-nums">
            {{ tile.note }}
          </span>
        </a>
      }
    } @else {
      @for (tile of skeleton; track tile.id) {
        <div class="bg-card flex flex-col gap-2 rounded-lg border px-4 py-3" aria-hidden="true">
          <hlm-skeleton class="h-3 w-16" />
          <hlm-skeleton class="h-7 w-20" />
          <hlm-skeleton class="h-3 w-24" />
        </div>
      }
    }
  `,
})
export class KpiTiles {
  private readonly store = inject(DashboardStore);
  protected readonly skeleton = TILES;

  protected readonly tiles = computed<Tile[] | null>(() => {
    const data = this.store.data();
    if (!data) return null;
    const filter = this.store.filter();
    return TILES.map((spec) => {
      const value = spec.value(data);
      return {
        id: spec.id,
        label: spec.label,
        value,
        accent: spec.accent,
        note: spec.share
          ? `${percentOf(value, data.total).toFixed(1)}% of events`
          : spec.id === 'types'
            ? 'distinct templates'
            : 'in this window',
        link: eventsLinkParams(filter, spec.extra),
      };
    });
  });
}
