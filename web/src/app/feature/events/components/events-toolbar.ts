import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBug, lucideKeyRound, lucideListFilter, lucideRefreshCw } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmToggle } from '@spartan-ng/helm/toggle';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { MultiSelect, MultiSelectOption } from '../../../shared/components/multi-select';
import { SearchInput } from '../../../shared/components/search-input';
import { ApiKeyLookup } from '../../../shared/data-access/api-key-lookup';
import { EventsStore } from '../data-access/events-store';
import { SignalsPanelLayout } from '../data-access/signals-panel-layout';
import { hasCustomRange, isTimeRange, TIME_RANGES } from '../models/event-filter';
import { FilterChips } from './filter-chips';
import { LevelFilter } from './level-filter';

@Component({
  selector: 'app-events-toolbar',
  imports: [
    SearchInput,
    LevelFilter,
    FilterChips,
    MultiSelect,
    HlmButton,
    HlmToggle,
    HlmToggleGroupImports,
    HlmTooltip,
    NgIcon,
  ],
  providers: [provideIcons({ lucideBug, lucideKeyRound, lucideListFilter, lucideRefreshCw })],
  host: { class: 'flex flex-col gap-2' },
  template: `
    @let filter = store.filter();
    <div class="flex flex-wrap items-center gap-2">
      <app-search-input
        class="min-w-56 flex-1"
        label="Search messages and exceptions"
        placeholder="Search messages and exceptions…"
        shortcutKey="/"
        [value]="filter.text"
        (search)="store.updateFilter({ text: $event })"
      />

      <app-level-filter
        [selected]="filter.levels"
        (selectedChange)="store.updateFilter({ levels: $event })"
      />

      <app-multi-select
        label="API keys"
        icon="lucideKeyRound"
        searchPlaceholder="Find API keys…"
        emptyText="No API keys."
        [options]="apiKeyOptions()"
        [selected]="filter.apiKeys"
        [loading]="apiKeys.isLoading()"
        (selectedChange)="store.setApiKeys($event)"
        (opened)="apiKeys.reload()"
      />

      <button
        hlmToggle
        variant="outline"
        size="sm"
        class="data-[state=on]:border-red-500/40 data-[state=on]:bg-red-500/10 data-[state=on]:text-red-700 dark:data-[state=on]:text-red-300"
        hlmTooltip="Only events with an exception"
        [state]="filter.hasException ? 'on' : 'off'"
        (stateChange)="store.updateFilter({ hasException: $event === 'on' })"
      >
        <ng-icon name="lucideBug" />
        Exceptions
      </button>

      <hlm-toggle-group
        type="single"
        variant="outline"
        size="sm"
        aria-label="Time range"
        [value]="customRange() ? null : filter.range"
        (valueChange)="setRange($event)"
      >
        @for (range of ranges; track range.id) {
          <button hlmToggleGroupItem [value]="range.id" [hlmTooltip]="range.title">
            {{ range.label }}
          </button>
        }
      </hlm-toggle-group>

      <button
        hlmToggle
        variant="outline"
        size="sm"
        class="data-[state=on]:border-emerald-500/50 data-[state=on]:bg-emerald-500/10 data-[state=on]:text-emerald-700 dark:data-[state=on]:text-emerald-300"
        hlmTooltip="Stream new events as they arrive"
        [state]="store.live() ? 'on' : 'off'"
        (stateChange)="store.setLive($event === 'on')"
      >
        <span class="relative flex size-2" aria-hidden="true">
          @if (store.liveStatus() === 'open') {
            <span
              class="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping"
            ></span>
          }
          <span
            class="relative inline-flex size-2 rounded-full"
            [class]="liveDotClass[store.liveStatus()]"
          ></span>
        </span>
        Live
      </button>

      <button
        hlmBtn
        variant="outline"
        size="icon-sm"
        aria-label="Refresh"
        hlmTooltip="Refresh"
        (click)="store.refresh()"
      >
        <ng-icon
          name="lucideRefreshCw"
          [class]="store.state() === 'loading' ? 'motion-safe:animate-spin' : ''"
        />
      </button>

      <button
        hlmBtn
        variant="outline"
        size="sm"
        hlmTooltip="Show or hide saved signals"
        [attr.aria-pressed]="layout.visible()"
        [class.bg-muted]="layout.visible()"
        (click)="layout.toggle()"
      >
        <ng-icon name="lucideListFilter" />
        Signals
        @if (filter.signals.length) {
          <span
            class="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4 tabular-nums"
            [attr.aria-label]="filter.signals.length + ' selected'"
            >{{ filter.signals.length }}</span
          >
        }
      </button>
    </div>
    <app-filter-chips />
  `,
})
export class EventsToolbar {
  protected readonly store = inject(EventsStore);
  protected readonly layout = inject(SignalsPanelLayout);
  protected readonly apiKeys = inject(ApiKeyLookup);
  protected readonly ranges = TIME_RANGES;
  protected readonly liveDotClass = {
    off: 'bg-muted-foreground/40',
    connecting: 'bg-amber-500 motion-safe:animate-pulse',
    open: 'bg-emerald-500',
    failed: 'bg-red-500',
  } as const;

  protected readonly customRange = computed(() => hasCustomRange(this.store.filter()));
  protected readonly apiKeyOptions = computed<MultiSelectOption[]>(() =>
    this.apiKeys.keys().map((key) => ({ id: key.id, label: key.title })),
  );

  protected setRange(value: unknown): void {
    if (isTimeRange(value)) this.store.setRange(value);
  }
}
