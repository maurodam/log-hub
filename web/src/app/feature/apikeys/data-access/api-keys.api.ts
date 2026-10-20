import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/app-config';
import { ApiKey, ApiKeyInput, CreatedApiKey } from '../models/api-key';

/** `/api/v1/apikeys` (Project permission). */
@Service()
export class ApiKeysApi {
  private readonly http = inject(HttpClient);
  readonly baseUrl = `${inject(API_BASE_URL)}/v1/apikeys`;

  create(input: ApiKeyInput): Observable<CreatedApiKey> {
    return this.http.post<CreatedApiKey>(this.baseUrl, input);
  }

  update(id: number, input: ApiKeyInput): Observable<ApiKey> {
    return this.http.put<ApiKey>(`${this.baseUrl}/${id}`, input);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
