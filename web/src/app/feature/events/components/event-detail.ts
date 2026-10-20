import { Clipboard } from '@angular/cdk/clipboard';
import { Component, computed, inject, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideFunnelPlus } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmKbd } from '@spartan-ng/helm/kbd';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { ApiKeyLookup } from '../../../shared/data-access/api-key-lookup';
import { EventsStore } from '../data-access/events-store';
import { LogEvent } from '../models/log-event';
import { formatPropertyFilterValue, PropertyFilter } from '../models/property-filter';
import { displayPropertyValue, PropertyValueKind } from '../models/property-value';
import { LevelBadge } from './level-badge';

const VALUE_CLASS: Record<PropertyValueKind, string> = {
  string: '',
  number: 'text-sky-700 dark:text-sky-300',
  boolean: 'text-violet-700 dark:text-violet-300',
  null: 'text-muted-foreground italic',
  json: '',
};

/** Expanded view of one event: full message, metadata, exception and properties. */
@Component({
  selector: 'app-event-detail',
  imports: [HlmButton, HlmKbd, HlmTooltip, LevelBadge, NgIcon],
  providers: [provideIcons({ lucideCopy, lucideFunnelPlus })],
  host: {
    class: 'bg-muted/30 block border-t px-4 py-3 text-sm',
    role: 'region',
    '[attr.id]': "'event-detail-' + event().id",
    '[attr.aria-label]': "'Details of event ' + event().id",
  },
  template: `
    <div class="flex items-start gap-3">
      <p class="min-w-0 flex-1 font-medium break-words whitespace-pre-wrap">
        {{ event().message ?? event().messageTemplate ?? '(no message)' }}
      </p>
      <div class="flex shrink-0 items-center gap-1">
        <button hlmBtn variant="outline" size="xs" (click)="copyJson()">
          <ng-icon name="lucideCopy" />
          Copy JSON
        </button>
        <button hlmBtn variant="ghost" size="xs" (click)="closed.emit()">
          Close <kbd hlmKbd>Esc</kbd>
        </button>
      </div>
    </div>

    <dl class="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-xs">
      <dt class="text-muted-foreground">Timestamp</dt>
      <dd class="font-mono">{{ event().timestamp }}</dd>
      <dt class="text-muted-foreground">Arrived</dt>
      <dd class="font-mono">{{ event().arrived }}</dd>
      <dt class="text-muted-foreground">Level</dt>
      <dd class="flex items-center gap-2">
        <app-level-badge [rank]="event().levelRank" [label]="event().level" />
        <span class="font-mono">{{ event().level }}</span>
      </dd>
      <dt class="text-muted-foreground">Event type</dt>
      <dd class="flex items-center gap-1 font-mono">
        {{ event().eventType }}
        <button
          hlmBtn
          variant="ghost"
          size="icon-xs"
          hlmTooltip="Show events of this type"
          aria-label="Show events of this type"
          (click)="store.updateFilter({ eventType: event().eventType })"
        >
          <ng-icon name="lucideFunnelPlus" />
        </button>
      </dd>
      @if (event().apiKeyId; as apiKeyId) {
        <dt class="text-muted-foreground">API key</dt>
        <dd class="flex items-center gap-1">
          <span>{{ apiKeys.titleOf(apiKeyId) }}</span>
          <span class="text-muted-foreground font-mono">#{{ apiKeyId }}</span>
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            hlmTooltip="Filter by this API key"
            aria-label="Filter by this API key"
            (click)="store.setApiKeys([apiKeyId])"
          >
            <ng-icon name="lucideFunnelPlus" />
          </button>
        </dd>
      }
      @if (event().traceId; as traceId) {
        <dt class="text-muted-foreground">Trace</dt>
        <dd class="flex items-center gap-1 font-mono break-all">
          {{ traceId }}
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            hlmTooltip="Show only this trace"
            aria-label="Show only this trace"
            (click)="filterByTrace(traceId)"
          >
            <ng-icon name="lucideFunnelPlus" />
          </button>
        </dd>
      }
      @if (event().spanId; as spanId) {
        <dt class="text-muted-foreground">Span</dt>
        <dd class="font-mono break-all">{{ spanId }}</dd>
      }
      @if (event().messageTemplate; as template) {
        <dt class="text-muted-foreground">Template</dt>
        <dd class="font-mono break-words whitespace-pre-wrap">{{ template }}</dd>
      }
    </dl>

    @if (event().exception; as exception) {
      <section class="mt-3">
        <h3 class="text-muted-foreground mb-1 text-xs font-medium">Exception</h3>
        <pre
          class="bg-background max-h-80 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed text-red-700 dark:text-red-300"
          tabindex="0"
          >{{ exception }}</pre>
      </section>
    }

    <section class="mt-3">
      <h3 class="text-muted-foreground mb-1 text-xs font-medium">
        Properties <span class="tabular-nums">({{ properties().length }})</span>
      </h3>
      @if (properties().length) {
        <dl class="bg-background divide-y rounded-md border text-xs">
          @for (property of properties(); track property.name) {
            <div class="grid grid-cols-[minmax(6rem,14rem)_minmax(0,1fr)] gap-3 px-3 py-1">
              <dt class="text-muted-foreground py-0.5 font-mono break-all">{{ property.name }}</dt>
              <dd class="flex min-w-0 items-start gap-2">
                @if (property.value.kind === 'json') {
                  <pre class="min-w-0 flex-1 py-0.5 font-mono whitespace-pre-wrap">{{
                    property.value.text
                  }}</pre>
                } @else {
                  <span
                    class="min-w-0 flex-1 py-0.5 font-mono break-words whitespace-pre-wrap"
                    [class]="valueClass[property.value.kind]"
                    >{{ property.value.text }}</span
                  >
                }
                @if (property.filter; as filter) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-xs"
                    hlmTooltip="Filter by this value"
                    [attr.aria-label]="'Filter by ' + property.name + ' = ' + filter.value"
                    (click)="store.addPropertyFilter(filter)"
                  >
                    <ng-icon name="lucideFunnelPlus" />
                  </button>
                }
              </dd>
            </div>
          }
        </dl>
      } @else {
        <p class="text-muted-foreground text-xs">No properties.</p>
      }
    </section>
  `,
})
export class EventDetail {
  readonly event = input.required<LogEvent>();
  readonly closed = output();

  protected readonly store = inject(EventsStore);
  protected readonly apiKeys = inject(ApiKeyLookup);
  private readonly clipboard = inject(Clipboard);
  protected readonly valueClass = VALUE_CLASS;

  protected readonly properties = computed(() =>
    Object.entries(this.event().properties).map(([name, value]) => {
      const filterValue = formatPropertyFilterValue(value);
      const filter: PropertyFilter | null =
        filterValue === null ? null : { name, value: filterValue };
      return { name, value: displayPropertyValue(value), filter };
    }),
  );

  protected copyJson(): void {
    const copied = this.clipboard.copy(JSON.stringify(this.event(), null, 2));
    if (copied) toast.success('Event JSON copied to clipboard');
    else toast.error('Could not copy to clipboard');
  }

  protected filterByTrace(traceId: string): void {
    this.store.updateFilter({ traceId });
  }
}
