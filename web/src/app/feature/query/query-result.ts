import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { displayMessage } from '../events/models/log-event';
import { Group, QueryResult, QueryWidget } from './query-api';

@Component({
  selector: 'app-query-result',
  imports: [DatePipe],
  template: `
    @if (events(); as rows) {
      @if (rows.length) {
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="text-muted-foreground">
              <tr>
                <th class="p-2" scope="col">Time</th>
                <th class="p-2" scope="col">Level</th>
                <th class="p-2" scope="col">Event</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              @for (event of rows; track event.id) {
                <tr>
                  <td class="whitespace-nowrap p-2 align-top">
                    {{ event.timestamp | date: 'medium' }}
                  </td>
                  <td class="p-2 align-top">{{ event.level }}</td>
                  <td class="min-w-48 p-2">
                    @if (event.exception) {
                      <details>
                        <summary class="cursor-pointer break-words">{{ message(event) }}</summary>
                        <pre class="mt-2 whitespace-pre-wrap break-words">{{
                          event.exception
                        }}</pre>
                      </details>
                    } @else {
                      {{ message(event) }}
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="text-muted-foreground text-sm" role="status">No matching events.</p>
      }
    } @else if (groups(); as rows) {
      @if (!rows.length) {
        <p class="text-muted-foreground text-sm" role="status">No matching groups.</p>
      } @else if (view() === 'number') {
        <p class="py-2 text-3xl font-semibold tabular-nums">{{ rows[0].value ?? '—' }}</p>
      } @else {
        @if (view() === 'series') {
          <div class="grid max-h-96 gap-1 overflow-auto" aria-hidden="true">
            @for (point of points(); track $index) {
              <div class="grid grid-cols-[minmax(7rem,auto)_1fr_auto] items-center gap-2 text-xs">
                <span class="text-muted-foreground">{{
                  point.key | date: 'MMM d, HH:mm' : 'UTC'
                }}</span>
                <div class="bg-muted relative h-2 rounded">
                  <span
                    class="bg-primary absolute h-full rounded"
                    [style.left.%]="point.left"
                    [style.width.%]="point.width"
                  ></span>
                  <span
                    class="bg-muted-foreground absolute h-full w-px"
                    [style.left.%]="point.zero"
                  ></span>
                </div>
                <span class="tabular-nums">{{ point.value ?? '—' }}</span>
              </div>
            }
          </div>
        }
        <table class="w-full text-left text-sm" [class.sr-only]="view() === 'series'">
          <thead class="text-muted-foreground">
            <tr>
              <th class="p-2" scope="col">{{ view() === 'series' ? 'Time (UTC)' : 'Group' }}</th>
              <th class="p-2" scope="col">Value</th>
            </tr>
          </thead>
          <tbody class="divide-y">
            @for (row of rows; track $index) {
              <tr>
                <td class="break-all p-2">{{ keyLabel(row.key) }}</td>
                <td class="p-2 tabular-nums">{{ row.value ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
        @if (rows.length === 100) {
          <p class="text-muted-foreground text-xs">
            Showing up to 100 groups. Use a shorter period or a more selective query.
          </p>
        }
      }
    }
  `,
})
export class QueryResultView {
  readonly result = input.required<QueryResult>();
  readonly view = input<QueryWidget['view']>('table');
  protected readonly message = displayMessage;
  protected readonly events = computed(() => {
    const response = this.result();
    return 'events' in response ? response.events : null;
  });
  protected readonly groups = computed<Group[] | null>(() => {
    const response = this.result();
    return 'groups' in response ? response.groups : null;
  });
  protected readonly points = computed(() => {
    const rows = (this.groups() ?? []).filter((row) => typeof row.key === 'string');
    const values = rows.map((row) => row.value ?? 0);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const position = (value: number) => (100 * (value - min)) / (max - min || 1);
    const zero = position(0);
    return rows.map((row, index) => ({
      key: row.key as string,
      value: row.value,
      left: Math.min(zero, position(values[index])),
      width: Math.abs(zero - position(values[index])),
      zero,
    }));
  });

  protected keyLabel(key: unknown): string {
    return key === null ? '—' : typeof key === 'string' ? key : JSON.stringify(key);
  }
}
