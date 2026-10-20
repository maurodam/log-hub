import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { ApiKeyLookup } from '../../../shared/data-access/api-key-lookup';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { EventsStore } from '../data-access/events-store';
import { hasCustomRange } from '../models/event-filter';

/**
 * Removable chips for filters without their own toolbar control: custom time window, event
 * type, API keys, trace and properties. Renders nothing when there are none.
 */
@Component({
  selector: 'app-filter-chips',
  imports: [HlmBadge, HlmButton, LocalTimePipe, NgIcon],
  providers: [provideIcons({ lucideX })],
  host: { class: 'flex flex-wrap items-center gap-1.5 empty:hidden' },
  template: `
    @let filter = store.filter();
    @if (customRange()) {
      <span hlmBadge variant="outline" class="h-6 gap-1 pe-0.5 font-mono">
        <span class="text-muted-foreground">time</span>
        {{ filter.from ? (filter.from | localTime) : '…' }} →
        {{ filter.to ? (filter.to | localTime) : 'now' }}
        <button
          type="button"
          class="hover:bg-muted rounded-full p-0.5"
          aria-label="Remove time window"
          (click)="store.setRange('all')"
        >
          <ng-icon name="lucideX" />
        </button>
      </span>
    }
    @if (filter.eventType) {
      <span hlmBadge variant="outline" class="h-6 gap-1 pe-0.5 font-mono">
        <span class="text-muted-foreground">type</span>
        {{ filter.eventType }}
        <button
          type="button"
          class="hover:bg-muted rounded-full p-0.5"
          aria-label="Remove event type filter"
          (click)="store.updateFilter({ eventType: '' })"
        >
          <ng-icon name="lucideX" />
        </button>
      </span>
    }
    @for (id of filter.apiKeys; track id) {
      <span hlmBadge variant="outline" class="h-6 gap-1 pe-0.5">
        <span class="text-muted-foreground">key</span>
        {{ apiKeys.titleOf(id) }}
        <button
          type="button"
          class="hover:bg-muted rounded-full p-0.5"
          [attr.aria-label]="'Remove API key filter ' + apiKeys.titleOf(id)"
          (click)="store.removeApiKey(id)"
        >
          <ng-icon name="lucideX" />
        </button>
      </span>
    }
    @if (filter.traceId) {
      <span hlmBadge variant="outline" class="h-6 gap-1 pe-0.5 font-mono">
        <span class="text-muted-foreground">trace</span>
        {{ filter.traceId }}
        <button
          type="button"
          class="hover:bg-muted rounded-full p-0.5"
          aria-label="Remove trace filter"
          (click)="store.updateFilter({ traceId: '' })"
        >
          <ng-icon name="lucideX" />
        </button>
      </span>
    }
    @for (property of filter.properties; track property.name + '=' + property.value) {
      <span hlmBadge variant="outline" class="h-6 gap-1 pe-0.5 font-mono">
        <span class="text-muted-foreground">{{ property.name }} =</span>
        {{ property.value }}
        <button
          type="button"
          class="hover:bg-muted rounded-full p-0.5"
          [attr.aria-label]="'Remove filter ' + property.name + ' = ' + property.value"
          (click)="store.removePropertyFilter(property)"
        >
          <ng-icon name="lucideX" />
        </button>
      </span>
    }
    @if (chipCount() > 1) {
      <button hlmBtn variant="link" size="xs" class="text-muted-foreground" (click)="clearChips()">
        Clear
      </button>
    }
  `,
})
export class FilterChips {
  protected readonly store = inject(EventsStore);
  protected readonly apiKeys = inject(ApiKeyLookup);

  protected readonly customRange = computed(() => hasCustomRange(this.store.filter()));
  protected readonly chipCount = computed(() => {
    const filter = this.store.filter();
    return (
      (this.customRange() ? 1 : 0) +
      (filter.eventType ? 1 : 0) +
      filter.apiKeys.length +
      (filter.traceId ? 1 : 0) +
      filter.properties.length
    );
  });

  protected clearChips(): void {
    this.store.updateFilter({
      from: '',
      to: '',
      range: this.customRange() ? 'all' : this.store.filter().range,
      eventType: '',
      apiKeys: [],
      traceId: '',
      properties: [],
    });
  }
}
