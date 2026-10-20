import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideHistory, lucideRefreshCw, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { EmptyState } from '../../../shared/components/empty-state';
import { DateTimePipe, TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { AlertsApi } from '../data-access/alerts.api';
import { Alert, AlertNotification } from '../models/alert';

/** Side sheet with the last 50 notifications of `alert` (open while `alert` is set). */
@Component({
  selector: 'app-notification-history',
  imports: [
    EmptyState,
    HlmBadge,
    HlmButton,
    HlmSheetImports,
    HlmSkeleton,
    HlmTooltip,
    NgIcon,
    TimeAgoPipe,
    DateTimePipe,
  ],
  providers: [provideIcons({ lucideHistory, lucideRefreshCw, lucideTriangleAlert })],
  template: `
    <hlm-sheet side="right" [state]="alert() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 sm:max-w-xl">
        <hlm-sheet-header class="border-b">
          <h2 hlmSheetTitle>Notification history</h2>
          <p hlmSheetDescription>{{ alert()?.title }} · last 50 notifications</p>
        </hlm-sheet-header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          @if (notifications.error()) {
            <p class="text-destructive flex items-center gap-2 p-4 text-sm" role="alert">
              <ng-icon name="lucideTriangleAlert" />
              Could not load the history.
              <button
                hlmBtn
                variant="link"
                size="sm"
                class="h-auto p-0"
                (click)="notifications.reload()"
              >
                Retry
              </button>
            </p>
          } @else if (notifications.isLoading() && !items().length) {
            <div class="grid gap-2 p-4" aria-busy="true" aria-label="Loading history">
              <hlm-skeleton class="h-12 w-full" />
              <hlm-skeleton class="h-12 w-full" />
              <hlm-skeleton class="h-12 w-full" />
            </div>
          } @else if (!items().length) {
            <app-empty-state
              icon="lucideHistory"
              title="No notifications yet"
              description="Notifications appear here when the alert fires or a test email is sent."
            />
          } @else {
            <ol class="divide-y">
              @for (item of items(); track item.id) {
                <li class="grid gap-1 px-4 py-2.5 text-sm">
                  <div class="flex items-center gap-2">
                    @if (item.status === 'Sent') {
                      <span
                        hlmBadge
                        class="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      >
                        Sent
                      </span>
                    } @else {
                      <span hlmBadge variant="destructive">Failed</span>
                    }
                    <span class="font-mono text-xs" [hlmTooltip]="item.triggeredDate | timeAgo">
                      {{ item.triggeredDate | dateTime }}
                    </span>
                    <span class="text-muted-foreground ms-auto text-xs tabular-nums">
                      {{ item.eventCount }} {{ item.eventCount === 1 ? 'event' : 'events' }}
                    </span>
                  </div>
                  <p
                    class="text-muted-foreground truncate text-xs"
                    [hlmTooltip]="item.recipients.join(', ')"
                  >
                    To {{ item.recipients.join(', ') || 'nobody' }}
                  </p>
                  @if (item.error) {
                    <p class="text-destructive font-mono text-xs break-words whitespace-pre-wrap">
                      {{ item.error }}
                    </p>
                  }
                </li>
              }
            </ol>
          }
        </div>

        <hlm-sheet-footer class="flex-row justify-end border-t">
          <button hlmBtn variant="outline" size="sm" (click)="notifications.reload()">
            <ng-icon name="lucideRefreshCw" />
            Refresh
          </button>
        </hlm-sheet-footer>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class NotificationHistory {
  readonly alert = input<Alert | null>(null);
  readonly closed = output();

  private readonly api = inject(AlertsApi);

  protected readonly notifications = httpResource<AlertNotification[]>(() => {
    const alert = this.alert();
    return alert ? this.api.notificationsUrl(alert.id) : undefined;
  });

  /** Newest first. */
  protected readonly items = computed(() => {
    const list = this.notifications.hasValue() ? (this.notifications.value() ?? []) : [];
    return [...list].sort((a, b) => b.triggeredDate.localeCompare(a.triggeredDate));
  });
}
