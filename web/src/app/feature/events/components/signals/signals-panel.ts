import { Component, computed, inject, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideInfo, lucidePlus, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { filter, switchMap, take } from 'rxjs';
import { SearchInput } from '../../../../shared/components/search-input';
import { LogSignal } from '../../../../shared/models/signal';
import { EventsStore } from '../../data-access/events-store';
import { SignalsStore } from '../../data-access/signals-store';
import { filterSpecFromEventFilter } from '../../models/signal-filter';
import {
  describeCombination,
  groupSignals,
  SIGNAL_COMBINATION_HINT,
} from '../../models/signal-groups';
import { ConfirmDialog, ConfirmDialogContext } from './confirm-dialog';
import { SignalDialog, SignalDialogContext } from './signal-dialog';
import { SignalItem } from './signal-item';

/** Signal list with search and multi-select; the selection is part of the events filter. */
@Component({
  selector: 'app-signals-panel',
  imports: [HlmButton, HlmSkeleton, HlmTooltip, NgIcon, SearchInput, SignalItem],
  providers: [provideIcons({ lucideInfo, lucidePlus, lucideTriangleAlert, lucideX })],
  host: { class: 'flex min-h-0 flex-col' },
  template: `
    <header class="flex h-11 shrink-0 items-center gap-1 border-b ps-3 pe-1.5">
      <h2 class="text-sm font-semibold">Signals</h2>
      <button
        hlmBtn
        variant="ghost"
        size="icon-xs"
        class="text-muted-foreground"
        [hlmTooltip]="hint"
        [attr.aria-label]="hint"
      >
        <ng-icon name="lucideInfo" />
      </button>
      <span class="flex-1"></span>
      @if (signals.canCreate()) {
        <button
          hlmBtn
          variant="ghost"
          size="xs"
          hlmTooltip="Save the current toolbar filters as a signal"
          (click)="create()"
        >
          <ng-icon name="lucidePlus" />
          Save as signal
        </button>
      }
      <button
        hlmBtn
        variant="ghost"
        size="icon-xs"
        aria-label="Hide signals"
        hlmTooltip="Hide signals"
        (click)="closed.emit()"
      >
        <ng-icon name="lucideX" />
      </button>
    </header>

    <div class="shrink-0 p-2">
      <app-search-input
        label="Find signals"
        placeholder="Find signals…"
        [debounceMs]="100"
        [value]="query()"
        (search)="query.set($event)"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      @if (signals.loading()) {
        <div class="grid gap-2 px-1.5 pt-1" aria-busy="true" aria-label="Loading signals">
          @for (width of skeletonWidths; track $index) {
            <hlm-skeleton class="h-4" [style.width.%]="width" />
          }
        </div>
      } @else if (signals.error(); as error) {
        <div class="flex flex-col items-center gap-2 px-3 py-8 text-center text-sm">
          <ng-icon name="lucideTriangleAlert" class="text-muted-foreground text-xl" />
          <p class="text-muted-foreground">{{ error }}</p>
          <button hlmBtn variant="outline" size="xs" (click)="signals.reload()">Try again</button>
        </div>
      } @else {
        @for (group of groups(); track group.name ?? '') {
          <section class="mt-1" [attr.aria-label]="group.name ?? 'Ungrouped signals'">
            <h3
              class="text-muted-foreground flex items-baseline gap-1.5 px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase"
            >
              <span class="truncate">{{ group.name ?? 'Ungrouped' }}</span>
              <span class="text-muted-foreground/70 font-normal tracking-normal normal-case">
                {{ group.name ? 'any of' : 'each' }}
              </span>
            </h3>
            @for (item of group.signals; track item.id) {
              <app-signal-item
                [signal]="item"
                [selected]="selectedIds().has(item.id)"
                [canManage]="signals.canManage(item)"
                (toggled)="store.toggleSignal(item.id)"
                (edit)="edit(item)"
                (remove)="remove(item)"
              />
            }
          </section>
        } @empty {
          <p class="text-muted-foreground px-3 py-8 text-center text-sm">
            @if (query()) {
              No signals match “{{ query() }}”.
            } @else if (signals.canCreate()) {
              No signals yet. Set some filters, then use “Save as signal”.
            } @else {
              No signals yet.
            }
          </p>
        }
      }
    </div>

    <footer class="flex min-h-10 shrink-0 items-center gap-2 border-t px-3 py-1.5 text-xs">
      @if (store.filter().signals.length) {
        <p class="min-w-0 flex-1">
          <span class="text-muted-foreground">Matching: </span>
          <span class="font-medium break-words">{{ combination() }}</span>
          @if (unknownCount()) {
            <span class="text-muted-foreground"> (+{{ unknownCount() }} unavailable) </span>
          }
        </p>
        <button hlmBtn variant="ghost" size="xs" (click)="store.setSignals([])">Clear</button>
      } @else {
        <p class="text-muted-foreground">Click signals to filter the events.</p>
      }
    </footer>
  `,
})
export class SignalsPanel {
  protected readonly store = inject(EventsStore);
  protected readonly signals = inject(SignalsStore);
  private readonly dialog = inject(HlmDialogService);

  /** Emits when the user hides the panel. */
  readonly closed = output();

  protected readonly hint = SIGNAL_COMBINATION_HINT;
  protected readonly skeletonWidths = [62, 80, 54, 71, 66, 48];
  protected readonly query = signal('');

  protected readonly selectedIds = computed(() => new Set(this.store.filter().signals));
  protected readonly groups = computed(() => groupSignals(this.signals.signals(), this.query()));
  private readonly selectedSignals = computed(() =>
    this.store
      .filter()
      .signals.map((id) => this.signals.byId().get(id))
      .filter((item): item is LogSignal => item !== undefined),
  );
  protected readonly combination = computed(() => describeCombination(this.selectedSignals()));
  protected readonly unknownCount = computed(() =>
    this.signals.loading() || this.signals.error()
      ? 0
      : this.store.filter().signals.length - this.selectedSignals().length,
  );

  protected create(): void {
    this.openDialog(null);
  }

  protected edit(item: LogSignal): void {
    this.openDialog(item);
  }

  protected remove(item: LogSignal): void {
    this.dialog
      .open<boolean, ConfirmDialogContext>(ConfirmDialog, {
        contentClass: 'sm:max-w-sm',
        context: {
          title: `Delete “${item.title}”?`,
          description: item.isShared
            ? 'This shared signal disappears for everyone. Alerts or retention policies using it may stop working.'
            : 'The signal is removed permanently.',
          confirmLabel: 'Delete',
        },
      })
      .closed$.pipe(
        take(1),
        filter((confirmed) => confirmed === true),
        switchMap(() => this.signals.delete(item)),
      )
      .subscribe({
        next: () => {
          toast.success(`Signal “${item.title}” deleted`);
          if (this.store.filter().signals.includes(item.id)) this.store.toggleSignal(item.id);
        },
        // The HTTP error interceptor already reports failures (e.g. protected signal → 400).
        error: () => undefined,
      });
  }

  private openDialog(item: LogSignal | null): void {
    const context: SignalDialogContext = {
      signal: item,
      currentFilter: filterSpecFromEventFilter(this.store.filter()),
      groupNames: this.signals.groupNames(),
      canShare: this.signals.canShare(),
    };
    this.dialog
      .open<LogSignal, SignalDialogContext>(SignalDialog, { contentClass: 'sm:max-w-md', context })
      .closed$.pipe(take(1))
      .subscribe((saved) => {
        if (!saved) return;
        this.signals.upsert(saved);
        toast.success(item ? `Signal “${saved.title}” updated` : `Signal “${saved.title}” saved`);
      });
  }
}
