import { DecimalPipe, DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowUp,
  lucideInbox,
  lucideLoaderCircle,
  lucideSearchX,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { injectVirtualizer } from '@tanstack/angular-virtual';
import { EmptyState } from '../../../shared/components/empty-state';
import { MAX_BUFFERED_EVENTS } from '../data-access/event-buffer';
import { EventsStore } from '../data-access/events-store';
import { hasActiveFilters } from '../models/event-filter';
import { EventDetail } from './event-detail';
import { EventRow } from './event-row';

/** Collapsed row height in px; real heights are measured. */
const ROW_ESTIMATE = 29;
/** Start fetching the next page when this many rows are left below the viewport. */
const LOAD_MORE_THRESHOLD = 40;
/** Scroll offsets up to this many px count as "at the top" for live mode. */
const TOP_THRESHOLD = 4;
const SKELETON_WIDTHS = [72, 54, 88, 61, 47, 79, 66, 58, 83, 51, 70, 63];

@Component({
  selector: 'app-event-list',
  imports: [DecimalPipe, EmptyState, EventDetail, EventRow, HlmButton, HlmSkeleton, NgIcon],
  providers: [
    provideIcons({
      lucideArrowUp,
      lucideInbox,
      lucideLoaderCircle,
      lucideSearchX,
      lucideTriangleAlert,
    }),
  ],
  host: {
    class: 'bg-card relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border',
    '(document:keydown.escape)': 'onEscape($event)',
  },
  template: `
    <div #scroller class="flex min-h-0 flex-1 flex-col overflow-auto [overflow-anchor:none]">
      @switch (view()) {
        @case ('loading') {
          <div aria-busy="true" aria-label="Loading events">
            @for (width of skeletonWidths; track $index) {
              <div
                class="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 border-b px-3 py-1.5"
              >
                <hlm-skeleton class="h-5 w-9" />
                <hlm-skeleton class="h-3 w-20" />
                <hlm-skeleton class="h-3" [style.width.%]="width" />
              </div>
            }
          </div>
        }
        @case ('error') {
          <app-empty-state
            icon="lucideTriangleAlert"
            title="Could not load events"
            [description]="store.error() ?? undefined"
          >
            <button hlmBtn variant="outline" size="sm" class="mt-2" (click)="store.refresh()">
              Try again
            </button>
          </app-empty-state>
        }
        @case ('empty') {
          @if (filtered()) {
            <app-empty-state
              icon="lucideSearchX"
              title="No events match these filters"
              [description]="
                store.live()
                  ? 'Live mode is on: matching events will appear here as they arrive.'
                  : 'Try a wider time range, other levels or fewer filters.'
              "
            >
              <button
                hlmBtn
                variant="outline"
                size="sm"
                class="mt-2"
                (click)="store.clearFilters()"
              >
                Clear filters
              </button>
            </app-empty-state>
          } @else {
            <app-empty-state
              icon="lucideInbox"
              title="No events yet"
              description="Events sent to the ingestion endpoint will show up here."
            />
          }
        }
        @default {
          <div class="relative w-full shrink-0" [style.height.px]="virtualizer.getTotalSize()">
            <div
              class="absolute inset-x-0 top-0"
              [style.transform]="'translateY(' + offsetTop() + 'px)'"
            >
              @for (item of virtualizer.getVirtualItems(); track item.key) {
                @if (store.events()[item.index]; as event) {
                  @let expanded = store.expandedId() === event.id;
                  <div #row class="border-b" [attr.data-index]="item.index">
                    <app-event-row
                      [event]="event"
                      [expanded]="expanded"
                      (toggled)="store.toggleExpanded(event.id)"
                    />
                    @if (expanded) {
                      <app-event-detail [event]="event" (closed)="collapse()" />
                    }
                  </div>
                }
              }
            </div>
          </div>
          <div class="text-muted-foreground flex shrink-0 justify-center py-3 text-xs">
            @if (store.loadingMore()) {
              <span class="flex items-center gap-2">
                <ng-icon name="lucideLoaderCircle" class="motion-safe:animate-spin" />
                Loading older events…
              </span>
            } @else if (store.loadMoreFailed()) {
              <span class="flex items-center gap-2">
                Could not load older events.
                <button hlmBtn variant="link" size="xs" (click)="store.loadMore()">Retry</button>
              </span>
            } @else if (store.trimmed()) {
              Only the newest {{ maxBuffered | number }} events are kept. Refresh to browse older
              ones.
            } @else if (!store.hasMore()) {
              End of results
            }
          </div>
        }
      }
    </div>

    @if (store.pendingCount()) {
      <button
        hlmBtn
        size="sm"
        class="absolute top-2 left-1/2 -translate-x-1/2 rounded-full shadow-md"
        (click)="showNewest()"
      >
        <ng-icon name="lucideArrowUp" />
        {{ store.pendingCount() | number }} new
        {{ store.pendingCount() === 1 ? 'event' : 'events' }}
      </button>
    }

    <div class="text-muted-foreground flex h-7 shrink-0 items-center gap-3 border-t px-3 text-xs">
      <span class="tabular-nums">
        {{ store.events().length | number }} {{ store.events().length === 1 ? 'event' : 'events' }}
        @if (store.hasMore()) {
          <span>· scroll for older</span>
        }
      </span>
      <span class="ms-auto flex items-center gap-2" aria-live="polite">
        @switch (store.liveStatus()) {
          @case ('connecting') {
            Live: connecting…
          }
          @case ('open') {
            <span class="text-emerald-700 dark:text-emerald-400">Live: streaming</span>
          }
          @case ('failed') {
            <span class="text-red-700 dark:text-red-400">Live stream disconnected</span>
            <button hlmBtn variant="link" size="xs" class="h-auto p-0" (click)="store.reconnect()">
              Reconnect
            </button>
          }
        }
      </span>
    </div>
  `,
})
export class EventList {
  protected readonly store = inject(EventsStore);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private readonly rows = viewChildren<ElementRef<HTMLDivElement>>('row');

  protected readonly skeletonWidths = SKELETON_WIDTHS;
  protected readonly maxBuffered = MAX_BUFFERED_EVENTS;

  protected readonly virtualizer = injectVirtualizer<HTMLDivElement, HTMLDivElement>(() => {
    const events = this.store.events();
    return {
      scrollElement: this.scroller(),
      count: events.length,
      estimateSize: () => ROW_ESTIMATE,
      // Keyed by id so measured heights survive live events being prepended.
      getItemKey: (index) => events[index]?.id ?? index,
      overscan: 10,
      // Measure in the next frame: avoids "ResizeObserver loop" errors when a row expands.
      useAnimationFrameWithResizeObserver: true,
    };
  });

  protected readonly view = computed(() => {
    const state = this.store.state();
    if (state !== 'ready') return state;
    return this.store.events().length ? 'list' : 'empty';
  });
  protected readonly filtered = computed(() => hasActiveFilters(this.store.filter()));
  protected readonly offsetTop = computed(() => this.virtualizer.getVirtualItems()[0]?.start ?? 0);
  private readonly atTop = computed(() => (this.virtualizer.scrollOffset() ?? 0) <= TOP_THRESHOLD);

  constructor() {
    // Measure rendered rows; the virtualizer keeps observing them, so expanding a row re-measures.
    afterRenderEffect(() => {
      for (const row of this.rows()) this.virtualizer.measureElement(row.nativeElement);
    });

    // Infinite scroll: fetch the next page when the last rendered row nears the end.
    effect(() => {
      const last = this.virtualizer.getVirtualItems().at(-1);
      const nearEnd = !!last && last.index >= this.store.events().length - LOAD_MORE_THRESHOLD;
      if (
        nearEnd &&
        this.store.hasMore() &&
        !this.store.loadingMore() &&
        !this.store.loadMoreFailed()
      ) {
        untracked(() => this.store.loadMore());
      }
    });

    // Live mode only inserts new events directly while the user looks at the top of the list.
    effect(() => {
      const atTop = this.atTop();
      untracked(() => this.store.setFollowing(atTop));
    });
  }

  protected showNewest(): void {
    this.virtualizer.scrollToOffset(0);
    this.store.flushPending();
  }

  /** Escape collapses the open row unless something else (dialog, menu, search) handled it. */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented || this.store.expandedId() === null) return;
    event.preventDefault();
    this.collapse();
  }

  protected collapse(): void {
    const id = this.store.expandedId();
    if (id === null) return;
    this.store.collapse();
    afterNextRender(() => this.document.getElementById(`event-row-${id}`)?.focus(), {
      injector: this.injector,
    });
  }
}
