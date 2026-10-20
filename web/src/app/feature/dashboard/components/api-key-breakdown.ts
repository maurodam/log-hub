import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../data-access/dashboard-store';
import { eventsLinkParams } from '../models/dashboard-filter';
import { percentOf } from '../models/stats';

/** Events per ingesting API key. Each row opens the events of that key. */
@Component({
  selector: 'app-api-key-breakdown',
  imports: [DecimalPipe, RouterLink],
  host: { class: 'block' },
  template: `
    @if (rows().length) {
      <ol class="grid gap-0.5">
        @for (row of rows(); track row.id) {
          <li>
            <a
              routerLink="/events"
              [queryParams]="row.link"
              class="hover:bg-muted/70 focus-visible:ring-ring/60 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
              [attr.aria-label]="
                row.title + ': ' + (row.count | number) + ' events. Show events of this API key.'
              "
            >
              <span class="truncate" [title]="row.title">{{ row.title }}</span>
              <span class="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
                <span
                  class="block h-full rounded-full bg-teal-500/80 dark:bg-teal-400/70"
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
      <p class="text-muted-foreground px-2 py-6 text-center text-sm">
        No events from API keys in this window.
      </p>
    }
  `,
})
export class ApiKeyBreakdown {
  private readonly store = inject(DashboardStore);

  protected readonly rows = computed(() => {
    const data = this.store.data();
    if (!data) return [];
    const filter = this.store.filter();
    const max = Math.max(1, ...data.apiKeys.map((key) => key.count));
    return data.apiKeys.map((key) => ({
      id: key.apiKeyId,
      title: key.title || `#${key.apiKeyId}`,
      count: key.count,
      percent: percentOf(key.count, data.total),
      width: (key.count / max) * 100,
      link: eventsLinkParams(filter, { apiKeys: [key.apiKeyId] }),
    }));
  });
}
