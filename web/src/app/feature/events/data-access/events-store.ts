import { HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { bufferTime, filter as rxFilter, Subscription } from 'rxjs';
import { errorMessage } from '../../../core/http/http-error';
import {
  DEFAULT_FILTER,
  EventFilter,
  filterFromQueryParams,
  filterToQueryParams,
  listQuery,
  normalizeIds,
  QueryValues,
  sameFilter,
  streamQuery,
  TimeRange,
} from '../models/event-filter';
import { LogEvent } from '../models/log-event';
import { PropertyFilter, samePropertyFilter } from '../models/property-filter';
import { toggleId } from '../models/signal-groups';
import { appendEvents, prependEvents } from './event-buffer';
import { StreamMessage, StreamStatus } from './event-stream';
import { EventsApi } from './events.api';

export type LoadState = 'loading' | 'ready' | 'error';
export type LiveStatus = 'off' | StreamStatus;

const PAGE_SIZE = 200;
/** Live events are applied in small batches so bursts do not re-render once per event. */
const LIVE_BATCH_MS = 200;

/**
 * State of the events page: filter (mirrored in the URL), loaded pages, live stream and the
 * expanded row. Provided by `EventsPage`, so it lives as long as the page.
 */
@Injectable()
export class EventsStore {
  private readonly api = inject(EventsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  /** Active filter. The URL query string is the source of truth, so views are shareable. */
  readonly filter = computed(() => filterFromQueryParams(this.queryParams()), {
    equal: sameFilter,
  });
  private readonly streamParams = computed(() => streamQuery(this.filter()), {
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  private readonly _events = signal<LogEvent[]>([]);
  /** Live events held back while the user is scrolled away from the top (newest first). */
  private readonly _pending = signal<LogEvent[]>([]);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _state = signal<LoadState>('loading');
  private readonly _error = signal<string | null>(null);
  private readonly _loadingMore = signal(false);
  private readonly _loadMoreFailed = signal(false);
  private readonly _trimmed = signal(false);
  private readonly _live = signal(false);
  private readonly _streamStatus = signal<StreamStatus>('connecting');
  private readonly _expandedId = signal<number | null>(null);
  private readonly _following = signal(true);
  private readonly reloadToken = signal(0);
  private readonly streamToken = signal(0);

  /** Query of the first page, reused for the following pages so the time window stays fixed. */
  private currentQuery: QueryValues = {};
  private moreRequest?: Subscription;

  readonly events = this._events.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadMoreFailed = this._loadMoreFailed.asReadonly();
  readonly trimmed = this._trimmed.asReadonly();
  readonly live = this._live.asReadonly();
  readonly expandedId = this._expandedId.asReadonly();
  readonly hasMore = computed(() => this._nextCursor() !== null);
  readonly pendingCount = computed(() => this._pending().length);
  readonly liveStatus = computed<LiveStatus>(() => (this._live() ? this._streamStatus() : 'off'));

  constructor() {
    // First page: reloads on filter change and refresh().
    effect((onCleanup) => {
      const filter = this.filter();
      this.reloadToken();
      const request = untracked(() => this.loadFirstPage(filter));
      onCleanup(() => request.unsubscribe());
    });

    // Live stream: reconnects when the stream filters change (every filter except the time range).
    effect((onCleanup) => {
      if (!this._live()) return;
      this.streamToken();
      const query = this.streamParams();
      const stream = untracked(() =>
        this.api
          .stream(query)
          .pipe(
            bufferTime(LIVE_BATCH_MS),
            rxFilter((batch) => batch.length > 0),
          )
          .subscribe((batch) => this.applyStreamBatch(batch)),
      );
      onCleanup(() => stream.unsubscribe());
    });
  }

  refresh(): void {
    this.reloadToken.update((token) => token + 1);
  }

  loadMore(): void {
    const cursor = this._nextCursor();
    if (!cursor || this._loadingMore() || this._state() !== 'ready') return;
    this._loadingMore.set(true);
    this._loadMoreFailed.set(false);
    this.moreRequest = this.api.list(this.currentQuery, { count: PAGE_SIZE, cursor }).subscribe({
      next: (page) => {
        this._events.update((events) => appendEvents(events, page.events));
        this._nextCursor.set(page.nextCursor);
        this._loadingMore.set(false);
      },
      error: () => {
        this._loadMoreFailed.set(true);
        this._loadingMore.set(false);
      },
    });
  }

  updateFilter(patch: Partial<EventFilter>): void {
    const next: EventFilter = { ...this.filter(), ...patch };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filterToQueryParams(next),
    });
  }

  clearFilters(): void {
    this.updateFilter(DEFAULT_FILTER);
  }

  addPropertyFilter(filter: PropertyFilter): void {
    const current = this.filter().properties;
    if (current.some((p) => samePropertyFilter(p, filter))) return;
    this.updateFilter({ properties: [...current, filter] });
  }

  removePropertyFilter(filter: PropertyFilter): void {
    this.updateFilter({
      properties: this.filter().properties.filter((p) => !samePropertyFilter(p, filter)),
    });
  }

  /** Switches to a relative range, dropping absolute bounds. */
  setRange(range: TimeRange): void {
    this.updateFilter({ range, from: '', to: '' });
  }

  toggleSignal(id: number): void {
    this.updateFilter({ signals: toggleId(this.filter().signals, id) });
  }

  setSignals(ids: readonly number[]): void {
    this.updateFilter({ signals: normalizeIds(ids) });
  }

  setApiKeys(ids: readonly number[]): void {
    this.updateFilter({ apiKeys: normalizeIds(ids) });
  }

  removeApiKey(id: number): void {
    this.setApiKeys(this.filter().apiKeys.filter((key) => key !== id));
  }

  setLive(on: boolean): void {
    this._streamStatus.set('connecting');
    this._live.set(on);
  }

  /** Opens a new live connection, e.g. after the browser gave up reconnecting. */
  reconnect(): void {
    this._streamStatus.set('connecting');
    this.streamToken.update((token) => token + 1);
  }

  toggleExpanded(id: number): void {
    this._expandedId.update((current) => (current === id ? null : id));
  }

  collapse(): void {
    this._expandedId.set(null);
  }

  /** Called by the list: while the user is at the top, live events go straight into the list. */
  setFollowing(following: boolean): void {
    this._following.set(following);
    if (following) this.flushPending();
  }

  /** Moves held-back live events into the list. */
  flushPending(): void {
    const pending = this._pending();
    if (!pending.length || this._state() !== 'ready') return;
    this._pending.set([]);
    this.prepend(pending);
  }

  private loadFirstPage(filter: EventFilter): Subscription {
    this.moreRequest?.unsubscribe();
    this.currentQuery = listQuery(filter, new Date());
    this._state.set('loading');
    this._error.set(null);
    this._events.set([]);
    this._pending.set([]);
    this._nextCursor.set(null);
    this._loadingMore.set(false);
    this._loadMoreFailed.set(false);
    this._trimmed.set(false);
    this._expandedId.set(null);

    return this.api.list(this.currentQuery, { count: PAGE_SIZE }).subscribe({
      next: (page) => {
        this._events.set(page.events);
        this._nextCursor.set(page.nextCursor);
        this._state.set('ready');
        if (this._following()) this.flushPending();
      },
      error: (error: unknown) => {
        this._error.set(describeError(error));
        this._state.set('error');
      },
    });
  }

  private applyStreamBatch(batch: readonly StreamMessage[]): void {
    const arrived: LogEvent[] = [];
    for (const message of batch) {
      if (message.kind === 'status') this._streamStatus.set(message.status);
      else arrived.push(message.event);
    }
    if (!arrived.length) return;
    arrived.reverse(); // the stream delivers oldest first, the list is newest first

    if (this._state() === 'ready' && this._following()) {
      this.prepend(arrived);
    } else {
      this._pending.update((pending) => prependEvents(pending, arrived).events);
    }
  }

  private prepend(newest: readonly LogEvent[]): void {
    const { events, trimmed } = prependEvents(this._events(), newest);
    this._events.set(events);
    if (trimmed) {
      // Older pages can no longer be fetched without leaving a gap.
      this.moreRequest?.unsubscribe();
      this._loadingMore.set(false);
      this._nextCursor.set(null);
      this._trimmed.set(true);
    }
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Unexpected error while loading events.';
  switch (error.status) {
    case 0:
      return 'The server could not be reached.';
    case 401:
      return 'Your session has expired. Sign in again.';
    case 403:
      return 'You do not have permission to read events.';
    default:
      return errorMessage(error) ?? `Request failed (${error.status}).`;
  }
}
