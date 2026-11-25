import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../../core/config/app-config';
import { skipErrorToast } from '../../core/http/http-context';
import { LogEventPage } from '../events/models/log-event';

export interface Group {
  key: unknown;
  value: number | null;
}

export type QueryResult = LogEventPage | { groups: Group[] };

export interface QueryWidget {
  title: string;
  expression: string;
  hours: number;
  view: 'number' | 'table' | 'series';
}

export interface SavedDashboard {
  id: number;
  name: string;
  widgets: QueryWidget[];
  revision: number;
}

export function queryRange(hours: number) {
  const now = Date.now();
  return { from: new Date(now - hours * 3_600_000).toISOString(), to: new Date(now).toISOString() };
}

@Injectable({ providedIn: 'root' })
export class QueryApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/v1`;
  readonly dashboardsUrl = `${this.base}/dashboards`;

  run(expression: string, range: { from: string; to: string }, cursor?: string) {
    return this.http.post<QueryResult>(
      `${this.base}/events/query`,
      { expression, ...range, cursor },
      { context: skipErrorToast() },
    );
  }

  save(dashboard: SavedDashboard) {
    return dashboard.id
      ? this.http.put<SavedDashboard>(`${this.dashboardsUrl}/${dashboard.id}`, dashboard)
      : this.http.post<SavedDashboard>(this.dashboardsUrl, dashboard);
  }

  delete(dashboard: SavedDashboard) {
    return this.http.delete(`${this.dashboardsUrl}/${dashboard.id}`, {
      params: { revision: dashboard.revision },
    });
  }
}
