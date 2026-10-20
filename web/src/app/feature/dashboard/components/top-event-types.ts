import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LevelBadge } from '../../events/components/level-badge';
import { DashboardStore } from '../data-access/dashboard-store';
import { eventsLinkParams } from '../models/dashboard-filter';
import { percentOf } from '../models/stats';

/** Most frequent message templates. Each row opens the events of that type. */
@Component({
  selector: 'app-top-event-types',
  imports: [DecimalPipe, LevelBadge, RouterLink],
  host: { class: 'block' },
  template: `
    @if (rows().length) {
      <div
        class="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)_7rem] gap-3 px-2 pb-1 text-[11px] font-medium tracking-wide uppercase"
        aria-hidden="true"
      >
        <span class="w-9">Level</span>
        <span>Message template</span>
        <span class="text-end">Events</span>
      </div>
      <ol class="grid gap-0.5">
        @for (row of rows(); track row.eventType) {
          <li>
            <a
              routerLink="/events"
              [queryParams]="row.link"
              class="hover:bg-muted/70 focus-visible:ring-ring/60 grid grid-cols-[auto_minmax(0,1fr)_7rem] items-center gap-3 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2"
              [attr.aria-label]="
                row.template + ': ' + (row.count | number) + ' events. Show events of this type.'
              "
            >
              <app-level-badge [rank]="row.rank" />
              <span class="min-w-0">
                <span class="block truncate font-mono text-xs" [title]="row.template">{{
                  row.template
                }}</span>
                <span class="text-muted-foreground block font-mono text-[10px]">{{
                  row.eventType
                }}</span>
              </span>
              <span class="grid gap-1">
                <span class="text-end text-xs tabular-nums">
                  {{ row.count | number }}
                  <span class="text-muted-foreground">· {{ row.percent | number: '1.0-1' }}%</span>
                </span>
                <span class="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                  <span
                    class="bg-primary/60 block h-full rounded-full"
                    [style.width.%]="row.width"
                  ></span>
                </span>
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
export class TopEventTypes {
  private readonly store = inject(DashboardStore);

  protected readonly rows = computed(() => {
    const data = this.store.data();
    if (!data) return [];
    const filter = this.store.filter();
    const max = Math.max(1, ...data.topEventTypes.map((type) => type.count));
    return data.topEventTypes.map((type) => ({
      eventType: type.eventType,
      template: type.messageTemplate?.trim() || '(no message template)',
      rank: type.levelRank,
      count: type.count,
      percent: percentOf(type.count, data.total),
      width: (type.count / max) * 100,
      link: eventsLinkParams(filter, { eventType: type.eventType }),
    }));
  });
}
