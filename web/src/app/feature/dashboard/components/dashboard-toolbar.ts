import { Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucideListFilter, lucideRefreshCw } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { MultiSelect, MultiSelectOption } from '../../../shared/components/multi-select';
import { SearchInput } from '../../../shared/components/search-input';
import { ApiKeyLookup } from '../../../shared/data-access/api-key-lookup';
import { SignalsApi } from '../../../shared/data-access/signals.api';
import { groupSignals } from '../../events/models/signal-groups';
import { AUTO_REFRESH_MS, DashboardStore } from '../data-access/dashboard-store';
import {
  DASHBOARD_RANGES,
  isCustomWindow,
  isDashboardRange,
  resolveWindow,
} from '../models/dashboard-filter';
import { CustomRangePicker } from './custom-range-picker';

/** Time range, signal / API key / text filters, refresh and auto-refresh. All kept in the URL. */
@Component({
  selector: 'app-dashboard-toolbar',
  imports: [
    CustomRangePicker,
    HlmButton,
    HlmLabel,
    HlmSwitch,
    HlmToggleGroupImports,
    HlmTooltip,
    MultiSelect,
    NgIcon,
    SearchInput,
  ],
  providers: [provideIcons({ lucideKeyRound, lucideListFilter, lucideRefreshCw })],
  host: { class: 'flex flex-wrap items-center gap-2' },
  template: `
    @let filter = store.filter();
    <hlm-toggle-group
      type="single"
      variant="outline"
      size="sm"
      aria-label="Time range"
      [value]="custom() ? null : filter.range"
      (valueChange)="setRange($event)"
    >
      @for (range of ranges; track range.id) {
        <button hlmToggleGroupItem [value]="range.id" [hlmTooltip]="range.title">
          {{ range.label }}
        </button>
      }
    </hlm-toggle-group>

    <app-custom-range-picker
      [from]="filter.from"
      [to]="filter.to"
      [fallback]="fallbackWindow()"
      (applied)="store.update({ from: $event.from, to: $event.to })"
      (cleared)="store.update({ from: '', to: '' })"
    />

    <app-multi-select
      label="Signals"
      icon="lucideListFilter"
      searchPlaceholder="Find signals…"
      emptyText="No signals."
      [options]="signalOptions()"
      [selected]="filter.signals"
      [loading]="signals.isLoading()"
      (selectedChange)="store.update({ signals: $event })"
      (opened)="signals.reload()"
    />

    <app-multi-select
      label="API keys"
      icon="lucideKeyRound"
      searchPlaceholder="Find API keys…"
      emptyText="No API keys."
      [options]="apiKeyOptions()"
      [selected]="filter.apiKeys"
      [loading]="apiKeys.isLoading()"
      (selectedChange)="store.update({ apiKeys: $event })"
      (opened)="apiKeys.reload()"
    />

    <app-search-input
      class="min-w-48 flex-1"
      label="Search messages and exceptions"
      placeholder="Search messages and exceptions…"
      shortcutKey="/"
      [value]="filter.text"
      (search)="store.update({ text: $event })"
    />

    <div class="flex items-center gap-2 ps-1">
      <hlm-switch
        inputId="dashboard-auto-refresh"
        size="sm"
        [checked]="filter.autoRefresh"
        (checkedChange)="store.update({ autoRefresh: $event })"
      />
      <label hlmLabel for="dashboard-auto-refresh" class="text-xs font-normal whitespace-nowrap">
        Auto-refresh ({{ autoSeconds }}s)
      </label>
    </div>

    <button
      hlmBtn
      variant="outline"
      size="sm"
      hlmTooltip="Reload the numbers now"
      [disabled]="store.busy()"
      (click)="store.refresh()"
    >
      <ng-icon name="lucideRefreshCw" [class]="store.busy() ? 'motion-safe:animate-spin' : ''" />
      Refresh
    </button>
  `,
})
export class DashboardToolbar {
  protected readonly store = inject(DashboardStore);
  protected readonly apiKeys = inject(ApiKeyLookup);
  private readonly signalsApi = inject(SignalsApi);

  protected readonly ranges = DASHBOARD_RANGES;
  protected readonly autoSeconds = AUTO_REFRESH_MS / 1000;

  protected readonly signals = rxResource({ stream: () => this.signalsApi.list() });

  protected readonly custom = computed(() => isCustomWindow(this.store.filter()));
  protected readonly fallbackWindow = computed(() =>
    resolveWindow({ ...this.store.filter(), from: '', to: '' }, new Date()),
  );

  protected readonly signalOptions = computed<MultiSelectOption[]>(() => {
    const list = this.signals.hasValue() ? this.signals.value() : [];
    return groupSignals(list).flatMap((group) =>
      group.signals.map((signal) => ({
        id: signal.id,
        label: signal.title,
        hint: signal.isShared ? undefined : 'personal',
        group: group.name ?? 'Ungrouped',
      })),
    );
  });

  protected readonly apiKeyOptions = computed<MultiSelectOption[]>(() =>
    this.apiKeys.keys().map((key) => ({ id: key.id, label: key.title })),
  );

  protected setRange(value: unknown): void {
    if (isDashboardRange(value)) this.store.update({ range: value, from: '', to: '' });
  }
}
