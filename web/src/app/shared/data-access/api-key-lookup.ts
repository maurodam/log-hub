import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../../core/config/app-config';

/** Entry of `GET /api/v1/apikeys/lookup` (Read permission): enough to label filters. */
export interface ApiKeyRef {
  id: number;
  title: string;
}

/**
 * API key titles for filters and event details. Loaded once per app; call `reload()` when a
 * picker opens so newly created keys show up.
 */
@Injectable({ providedIn: 'root' })
export class ApiKeyLookup {
  private readonly url = `${inject(API_BASE_URL)}/v1/apikeys/lookup`;
  private readonly resource = httpResource<ApiKeyRef[]>(() => this.url, { defaultValue: [] });

  readonly keys = computed(() =>
    // value() throws while the resource is in error state, hence the hasValue() guard.
    this.resource.hasValue()
      ? [...this.resource.value()].sort((a, b) => a.title.localeCompare(b.title))
      : [],
  );
  readonly isLoading = this.resource.isLoading;
  readonly error = this.resource.error;
  private readonly titles = computed(() => new Map(this.keys().map((key) => [key.id, key.title])));

  /** Title of the key, or `#id` when unknown (deleted key or lookup not loaded yet). */
  titleOf(id: number): string {
    return this.titles().get(id) ?? `#${id}`;
  }

  reload(): void {
    this.resource.reload();
  }
}
