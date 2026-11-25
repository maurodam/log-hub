import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { firstValueFrom } from 'rxjs';
import { serverErrorMessage } from '../../shared/utils/server-error';
import { QueryApi, queryRange, QueryResult } from './query-api';
import { QueryResultView } from './query-result';

@Component({
  imports: [FormsModule, HlmButton, QueryResultView, RouterLink],
  host: { class: 'grid gap-4' },
  template: `
    <header class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">Query events</h2>
      <a hlmBtn variant="outline" routerLink="/dashboard/saved">Saved dashboards</a>
    </header>
    <form class="grid gap-3 rounded-lg border p-4" (ngSubmit)="run()">
      <label class="grid gap-1 text-sm"
        >Expression
        <textarea
          name="expression"
          rows="4"
          maxlength="4096"
          [(ngModel)]="expression"
          class="bg-background rounded-md border p-2 font-mono text-sm"
          placeholder="WHERE level &gt;= 'Error' GROUP BY properties.App SELECT count()"
        ></textarea>
      </label>
      <div class="flex flex-wrap items-end gap-3">
        <label class="grid gap-1 text-sm"
          >Period
          <select
            name="hours"
            [(ngModel)]="hours"
            class="bg-background rounded-md border px-2 py-2"
          >
            @for (period of periods; track period.value) {
              <option [ngValue]="period.value">{{ period.label }}</option>
            }
          </select>
        </label>
        <button hlmBtn [disabled]="loading()" type="submit">Run query</button>
      </div>
      <details class="text-muted-foreground text-sm">
        <summary class="cursor-pointer">Query syntax</summary>
        <p class="mt-2 break-words">
          Combine comparisons with AND, OR, NOT and parentheses. Filter message or exception with
          CONTAINS. Group by a field, or by BUCKET('1m' / '5m' / '1h' / '1d'), and select count(),
          min(field), max(field), avg(field) or sum(field).
        </p>
      </details>
    </form>
    @if (failure(); as error) {
      <p class="text-destructive text-sm" role="alert">{{ error }}</p>
    }
    @if (loading()) {
      <p class="text-muted-foreground text-sm" role="status">Running query…</p>
    }
    @if (result(); as data) {
      <section class="min-w-0 rounded-lg border p-3" aria-label="Query results">
        <app-query-result [result]="data" />
        @if ('nextCursor' in data && data.nextCursor) {
          <button
            hlmBtn
            variant="outline"
            class="mt-2"
            [disabled]="loading()"
            (click)="run(data.nextCursor)"
          >
            Load older events
          </button>
        }
      </section>
    }
  `,
})
export class QueryPage {
  private readonly api = inject(QueryApi);
  private active?: { expression: string; range: ReturnType<typeof queryRange> };
  protected expression = '';
  protected hours = 24;
  protected readonly periods = [
    { value: 1, label: 'Last hour' },
    { value: 6, label: 'Last 6 hours' },
    { value: 24, label: 'Last 24 hours' },
    { value: 168, label: 'Last 7 days' },
    { value: 720, label: 'Last 30 days' },
  ];
  protected readonly result = signal<QueryResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly failure = signal('');

  protected async run(cursor?: string) {
    if (!cursor) {
      this.active = { expression: this.expression, range: queryRange(this.hours) };
      this.result.set(null);
    }
    if (!this.active) return;

    this.failure.set('');
    this.loading.set(true);
    try {
      const result = await firstValueFrom(
        this.api.run(this.active.expression, this.active.range, cursor),
      );
      const previous = this.result();
      this.result.set(
        cursor && previous && 'events' in previous && 'events' in result
          ? { ...result, events: [...previous.events, ...result.events] }
          : result,
      );
    } catch (error) {
      this.failure.set(serverErrorMessage(error, 'The query could not be run.'));
    } finally {
      this.loading.set(false);
    }
  }
}
