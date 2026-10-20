import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBell, lucideMailWarning, lucidePlus, lucideTriangleAlert } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state';
import { AlertCard } from '../components/alert-card';
import { AlertEditor, AlertEditorContext } from '../components/alert-editor';
import { NotificationHistory } from '../components/notification-history';
import { AlertsStore } from '../data-access/alerts-store';
import { Alert } from '../models/alert';

@Component({
  selector: 'app-alerts-page',
  imports: [
    AlertCard,
    EmptyState,
    HlmAlertImports,
    HlmButton,
    HlmSkeleton,
    NgIcon,
    NotificationHistory,
    RouterLink,
  ],
  providers: [
    AlertsStore,
    provideIcons({ lucideBell, lucideMailWarning, lucidePlus, lucideTriangleAlert }),
  ],
  host: { class: 'mx-auto flex w-full max-w-5xl flex-col gap-4' },
  template: `
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Alerts</h2>
        <p class="text-muted-foreground text-sm">
          Email notifications when matching events cross a threshold.
        </p>
      </div>
      @if (store.canChange() && store.sortedAlerts().length) {
        <button hlmBtn size="sm" (click)="openEditor(null)">
          <ng-icon name="lucidePlus" />
          New alert
        </button>
      }
    </header>

    @if (store.smtpMissing()) {
      <div hlmAlert>
        <ng-icon name="lucideMailWarning" class="text-amber-600 dark:text-amber-400" />
        <h3 hlmAlertTitle>Email is not configured</h3>
        <p hlmAlertDescription>
          Alerts are checked, but no email can be sent until an SMTP server is set up.
          <a routerLink="/email">Configure email</a>
        </p>
      </div>
    }

    @if (!store.canRead()) {
      <app-empty-state
        icon="lucideBell"
        title="Alerts need the Read permission"
        description="Ask an administrator for access."
      />
    } @else if (store.alerts.error()) {
      <div hlmAlert variant="destructive">
        <ng-icon name="lucideTriangleAlert" />
        <h3 hlmAlertTitle>Could not load alerts</h3>
        <p hlmAlertDescription>Check the connection to the server and try again.</p>
        <button hlmAlertAction hlmBtn size="sm" variant="outline" (click)="store.alerts.reload()">
          Retry
        </button>
      </div>
    } @else if (store.alerts.isLoading() && !store.alerts.hasValue()) {
      <div class="grid gap-2" aria-busy="true" aria-label="Loading alerts">
        @for (row of [1, 2, 3]; track row) {
          <hlm-skeleton class="h-24 w-full rounded-xl" />
        }
      </div>
    } @else if (!store.sortedAlerts().length) {
      <app-empty-state
        icon="lucideBell"
        title="No alerts yet"
        description="Get an email when errors spike, an exception shows up or a service goes quiet."
      >
        @if (store.canChange()) {
          <button hlmBtn class="mt-2" (click)="openEditor(null)">
            <ng-icon name="lucidePlus" />
            Create your first alert
          </button>
        }
      </app-empty-state>
    } @else {
      <ul class="grid gap-2" aria-label="Alerts">
        @for (alert of store.sortedAlerts(); track alert.id) {
          <li>
            <app-alert-card
              [alert]="alert"
              [canChange]="store.canChange()"
              (toggle)="store.setEnabled(alert, $event)"
              (edit)="openEditor(alert)"
              (history)="historyFor.set(alert)"
              (remove)="confirmDelete(alert)"
            />
          </li>
        }
      </ul>
    }

    <app-notification-history [alert]="historyFor()" (closed)="historyFor.set(null)" />
  `,
})
export class AlertsPage {
  protected readonly store = inject(AlertsStore);
  private readonly dialog = inject(HlmDialogService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly historyFor = signal<Alert | null>(null);

  protected openEditor(alert: Alert | null): void {
    this.store.refreshLookups();
    const context: AlertEditorContext = {
      alert,
      signals: this.store.signals,
      apiKeys: this.store.apiKeys,
      lookupsLoading: this.store.lookupsLoading,
      save: (input) => this.store.save(alert?.id ?? null, input),
    };
    this.dialog
      .open<Alert>(AlertEditor, {
        context,
        contentClass: 'sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto',
      })
      .closed$.subscribe((saved) => {
        if (saved) toast.success(`Alert "${saved.title}" ${alert ? 'saved' : 'created'}`);
      });
  }

  protected confirmDelete(alert: Alert): void {
    void this.confirm.confirm({
      title: `Delete the alert "${alert.title}"?`,
      description: 'LogHub stops checking it and its settings are lost. This cannot be undone.',
      confirmLabel: 'Delete alert',
      action: () => this.store.remove(alert),
    });
  }
}
