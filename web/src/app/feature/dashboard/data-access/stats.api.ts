import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/app-config';
import { skipErrorToast } from '../../../core/http/http-context';
import { QueryValues } from '../../events/models/event-filter';
import { StatsOverview } from '../models/stats';

@Injectable({ providedIn: 'root' })
export class StatsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${inject(API_BASE_URL)}/v1/stats`;

  /** Totals, time series and top lists. Errors are shown on the page, not as a toast. */
  overview(query: QueryValues): Observable<StatsOverview> {
    return this.http.get<StatsOverview>(`${this.baseUrl}/overview`, {
      params: new HttpParams({ fromObject: query }),
      context: skipErrorToast(),
    });
  }
}
