import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { errorMessage } from '../../../core/http/http-error';
import {
  DashboardFilter,
  dashboardFilterFromParams,
  dashboardFilterToParams,
  resolveWindow,
  statsQuery,
} from '../models/dashboard-filter';
import { StatsOverview } from '../models/stats';
import { StatsApi } from './stats.api';

export type DashboardState = 'loading' | 'ready' | 'error';

export const AUTO_REFRESH_MS = 30_000;

const sameParams = (a: DashboardFilter, b: DashboardFilter) =>
  JSON.stringify(dashboardFilterToParams(a)) === JSON.stringify(dashboardFilterToParams(b));

/**
 * Dashboard state: filter (mirrored in the URL), the loaded overview and auto-refresh.
 * Refreshing the same view keeps the current numbers on screen until new ones arrive.
 */
@Injectable()
export class DashboardStore {
  private readonly api = inject(StatsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  readonly filter = computed(() => dashboardFilterFromParams(this.queryParams()), {
    equal: sameParams,
  });
  /** What the data depends on: toggling auto-refresh alone does not reload. */
  private readonly dataFilter = computed(() => ({ ...this.filter(), autoRefresh: false }), {
    equal: sameParams,
  });

  private readonly _data = signal<StatsOverview | null>(null);
  private readonly _state = signal<DashboardState>('loading');
  private readonly _error = signal<string | null>(null);
  private readonly _refreshing = signal(false);
  private readonly _refreshFailed = signal(false);
  private readonly _updatedAt = signal<Date | null>(null);
  private readonly tick = signal(0);
  private lastKey = '';

  readonly data = this._data.asReadonly();
  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();
  readonly refreshing = this._refreshing.asReadonly();
  readonly refreshFailed = this._refreshFailed.asReadonly();
  readonly updatedAt = this._updatedAt.asReadonly();
  readonly busy = computed(() => this._state() === 'loading' || this._refreshing());

  constructor() {
    effect((onCleanup) => {
      const filter = this.dataFilter();
      this.tick();
      const request = untracked(() => this.load(filter));
      onCleanup(() => request.unsubscribe());
    });

    effect((onCleanup) => {
      if (!this.filter().autoRefresh) return;
      const timer = setInterval(() => {
        // Skip while the tab is in the background; the next visible tick catches up.
        if (!this.document.hidden) this.refresh();
      }, AUTO_REFRESH_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  refresh(): void {
    this.tick.update((tick) => tick + 1);
  }

  update(patch: Partial<DashboardFilter>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: dashboardFilterToParams({ ...this.filter(), ...patch }),
    });
  }

  private load(filter: DashboardFilter): Subscription {
    const key = JSON.stringify(dashboardFilterToParams(filter));
    const sameView = key === this.lastKey && this._data() !== null;
    this.lastKey = key;
    this._error.set(null);
    this._refreshFailed.set(false);
    if (sameView) {
      this._refreshing.set(true);
    } else {
      this._state.set('loading');
      this._data.set(null);
    }

    const window = resolveWindow(filter, new Date());
    return this.api.overview(statsQuery(filter, window)).subscribe({
      next: (data) => {
        this._data.set(data);
        this._state.set('ready');
        this._refreshing.set(false);
        this._updatedAt.set(new Date());
      },
      error: (error: unknown) => {
        this._refreshing.set(false);
        if (sameView) {
          this._refreshFailed.set(true);
        } else {
          this._error.set(describeError(error));
          this._state.set('error');
        }
      },
    });
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Unexpected error while loading statistics.';
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
