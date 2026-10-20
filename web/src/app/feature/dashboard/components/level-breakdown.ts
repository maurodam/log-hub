import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LevelBadge } from '../../events/components/level-badge';
import { LEVEL_STYLES, levelFromRank } from '../../events/models/log-level';
import { DashboardStore } from '../data-access/dashboard-store';
import { eventsLinkParams } from '../models/dashboard-filter';
import { percentOf } from '../models/stats';

/** Events per level as horizontal bars, most severe first. Each row opens those events. */
@Component({
  selector: 'app-level-breakdown',
  imports: [DecimalPipe, LevelBadge, RouterLink],
  host: { class: 'block' },
  template: `
    @if (rows().length) {
      <ol class="grid gap-0.5">
        @for (row of rows(); track row.level) {
          <li>
            <a
              routerLink="/events"
              [queryParams]="row.link"
              class="hover:bg-muted/70 focus-visible:ring-ring/60 grid grid-cols-[auto_6.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
              [attr.aria-label]="
                row.level +
                ': ' +
                (row.count | number) +
                ' events, ' +
                (row.percent | number: '1.0-1') +
                '%'
              "
            >
              <app-level-badge [rank]="row.rank" />
              <span class="truncate">{{ row.level }}</span>
              <span class="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
                <span
                  class="block h-full rounded-full"
                  [class]="row.color"
                  [style.width.%]="row.width"
                ></span>
              </span>
              <span class="text-end text-xs tabular-nums">
                {{ row.count | number }}
                <span class="text-muted-foreground ms-1 inline-block w-11"
                  >{{ row.percent | number: '1.0-1' }}%</span
                >
              </span>
            </a>
          </li>
        }
      </ol>
    } @else {
      <p class="text-muted-foreground px-2 py-6 text-center text-sm">No events in this window.</p>
    }
  `,
})
export class LevelBreakdown {
  private readonly store = inject(DashboardStore);

  protected readonly rows = computed(() => {
    const data = this.store.data();
    if (!data) return [];
    const filter = this.store.filter();
    const max = Math.max(1, ...data.levels.map((level) => level.count));
    return [...data.levels]
      .sort((a, b) => b.levelRank - a.levelRank)
      .map((entry) => {
        const level = levelFromRank(entry.levelRank);
        return {
          level,
          rank: entry.levelRank,
          count: entry.count,
          percent: percentOf(entry.count, data.total),
          width: (entry.count / max) * 100,
          color: LEVEL_STYLES[level].dot,
          link: eventsLinkParams(filter, { levels: [level] }),
        };
      });
  });
}
