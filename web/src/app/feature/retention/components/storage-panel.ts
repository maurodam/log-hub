import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCollapsibleImports } from '@spartan-ng/helm/collapsible';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { DateTimePipe, TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { RetentionStore } from '../data-access/retention-store';
import { formatBytes, formatCount } from '../models/retention-format';

/** Totals from GET /retention/storage plus a collapsible list of daily partitions. */
@Component({
  selector: 'app-storage-panel',
  imports: [
    HlmButton,
    HlmCollapsibleImports,
    HlmSkeleton,
    HlmTableImports,
    NgIcon,
    TimeAgoPipe,
    DateTimePipe,
  ],
  providers: [provideIcons({ lucideChevronRight, lucideTriangleAlert })],
  host: { class: 'bg-card ring-foreground/10 block rounded-xl ring-1' },
  template: `
    <h2 class="sr-only">Storage</h2>
    @if (store.storage.error()) {
      <p class="text-destructive flex items-center gap-2 p-4 text-sm" role="alert">
        <ng-icon name="lucideTriangleAlert" />
        Could not load storage information.
        <button hlmBtn variant="link" size="sm" class="h-auto p-0" (click)="store.storage.reload()">
          Retry
        </button>
      </p>
    } @else {
      <dl class="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div class="grid gap-1 px-4 py-3">
          <dt class="text-muted-foreground text-xs font-medium tracking-wide uppercase">Events</dt>
          <dd class="font-mono text-xl font-semibold tabular-nums">
            @if (info(); as info) {
              {{ count(info.totalEvents) }}
            } @else {
              <hlm-skeleton class="h-7 w-24" />
            }
          </dd>
        </div>
        <div class="grid gap-1 px-4 py-3">
          <dt class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Size on disk
          </dt>
          <dd class="font-mono text-xl font-semibold tabular-nums">
            @if (info(); as info) {
              {{ bytes(info.totalBytes) }}
            } @else {
              <hlm-skeleton class="h-7 w-20" />
            }
          </dd>
        </div>
        <div class="grid gap-1 px-4 py-3">
          <dt class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Oldest event
          </dt>
          <dd>
            @if (info(); as info) {
              @if (info.oldestEvent; as oldest) {
                <span class="text-xl font-semibold">{{ oldest | timeAgo }}</span>
                <span class="text-muted-foreground block font-mono text-xs">{{
                  oldest | dateTime
                }}</span>
              } @else {
                <span class="text-muted-foreground text-xl font-semibold">None</span>
              }
            } @else {
              <hlm-skeleton class="h-7 w-28" />
            }
          </dd>
        </div>
      </dl>

      @if (partitions().length) {
        <div hlmCollapsible [(expanded)]="expanded" class="border-t">
          <button hlmCollapsibleTrigger hlmBtn variant="ghost" size="sm" class="m-1 justify-start">
            <ng-icon
              name="lucideChevronRight"
              class="transition-transform"
              [class.rotate-90]="expanded()"
            />
            Daily partitions
            <span class="text-muted-foreground font-normal">({{ partitions().length }})</span>
          </button>
          <div hlmCollapsibleContent>
            <div hlmTableContainer class="max-h-80 overflow-y-auto border-t">
              <table hlmTable class="text-xs">
                <thead hlmTHead class="bg-muted/50 sticky top-0">
                  <tr hlmTr>
                    <th hlmTh class="h-8 px-4">Partition</th>
                    <th hlmTh class="h-8">From</th>
                    <th hlmTh class="h-8">To</th>
                    <th hlmTh class="h-8 text-end">Rows (est.)</th>
                    <th hlmTh class="h-8 px-4 text-end">Size</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (partition of partitions(); track partition.name) {
                    <tr hlmTr>
                      <td hlmTd class="px-4 font-mono">{{ partition.name }}</td>
                      <td hlmTd class="font-mono">{{ partition.from | dateTime }}</td>
                      <td hlmTd class="font-mono">{{ partition.to | dateTime }}</td>
                      <td hlmTd class="text-end font-mono tabular-nums">
                        ~{{ count(partition.rows) }}
                      </td>
                      <td hlmTd class="px-4 text-end font-mono tabular-nums">
                        {{ bytes(partition.bytes) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class StoragePanel {
  protected readonly store = inject(RetentionStore);
  protected readonly expanded = signal(false);

  protected readonly info = computed(() =>
    this.store.storage.hasValue() ? (this.store.storage.value() ?? null) : null,
  );

  /** Newest partition first. */
  protected readonly partitions = computed(() =>
    [...(this.info()?.partitions ?? [])].sort((a, b) => b.from.localeCompare(a.from)),
  );

  protected readonly count = formatCount;
  protected readonly bytes = formatBytes;
}
