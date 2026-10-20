import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDatabase,
  lucideInfo,
  lucidePlay,
  lucidePlus,
  lucideRefreshCw,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state';
import { PolicyDialog, PolicyDialogContext } from '../components/policy-dialog';
import { PolicyTable, PolicyToggle } from '../components/policy-table';
import { StoragePanel } from '../components/storage-panel';
import { RetentionStore } from '../data-access/retention-store';
import { policyTarget, RetentionPolicy } from '../models/retention';
import { formatRetentionDays } from '../models/retention-format';

@Component({
  selector: 'app-retention-page',
  imports: [EmptyState, HlmAlertImports, HlmButton, HlmSkeleton, NgIcon, PolicyTable, StoragePanel],
  providers: [
    RetentionStore,
    provideIcons({
      lucideDatabase,
      lucideInfo,
      lucidePlay,
      lucidePlus,
      lucideRefreshCw,
      lucideTriangleAlert,
    }),
  ],
  host: { class: 'mx-auto flex w-full max-w-5xl flex-col gap-4' },
  template: `
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Retention</h2>
        <p class="text-muted-foreground text-sm">
          How long LogHub keeps events, and the space they use.
        </p>
      </div>
      @if (store.canManage()) {
        <div class="flex flex-wrap gap-2">
          <button hlmBtn variant="ghost" size="sm" (click)="store.refresh()">
            <ng-icon name="lucideRefreshCw" />
            Refresh
          </button>
          <button hlmBtn variant="outline" size="sm" [disabled]="running()" (click)="run()">
            <ng-icon name="lucidePlay" />
            Run now
          </button>
          <button hlmBtn size="sm" (click)="openEditor(null)">
            <ng-icon name="lucidePlus" />
            New policy
          </button>
        </div>
      }
    </header>

    @if (!store.canManage()) {
      <app-empty-state
        icon="lucideDatabase"
        title="Retention needs the Project permission"
        description="Ask an administrator for a role with the Project permission to view storage and retention policies."
      />
    } @else {
      <app-storage-panel />

      <div hlmAlert>
        <ng-icon name="lucideInfo" />
        <h3 hlmAlertTitle>How retention works</h3>
        <div hlmAlertDescription>
          The job runs every hour. The <strong>all-events</strong> policy drops whole days of data
          older than its period: fast, and disk space is freed at once. <strong>Signal</strong>
          policies delete only the matching events, in batches, so they can keep noisy events for
          less time. Deleted events cannot be restored.
        </div>
      </div>

      <section class="grid gap-2" aria-labelledby="policies-title">
        <h3 id="policies-title" class="text-sm font-semibold">Policies</h3>
        <div class="bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1">
          @if (store.policies.error()) {
            <p class="text-destructive flex items-center gap-2 p-4 text-sm" role="alert">
              <ng-icon name="lucideTriangleAlert" />
              Could not load retention policies.
              <button
                hlmBtn
                variant="link"
                size="sm"
                class="h-auto p-0"
                (click)="store.policies.reload()"
              >
                Retry
              </button>
            </p>
          } @else if (store.policies.isLoading() && !store.policies.hasValue()) {
            <div class="grid gap-2 p-4" aria-busy="true" aria-label="Loading policies">
              <hlm-skeleton class="h-6 w-full" />
              <hlm-skeleton class="h-6 w-full" />
              <hlm-skeleton class="h-6 w-2/3" />
            </div>
          } @else if (!store.sortedPolicies().length) {
            <app-empty-state
              icon="lucideDatabase"
              title="No retention policies"
              description="Events are kept forever. Add an all-events policy to cap disk usage."
            >
              <button hlmBtn size="sm" class="mt-2" (click)="openEditor(null)">
                <ng-icon name="lucidePlus" />
                New policy
              </button>
            </app-empty-state>
          } @else {
            <app-policy-table
              [policies]="store.sortedPolicies()"
              [canManage]="store.canManage()"
              [pendingEnableId]="pendingEnableId()"
              (edit)="openEditor($event)"
              (remove)="confirmDelete($event)"
              (toggle)="toggle($event)"
            />
          }
        </div>
      </section>
    }
  `,
})
export class RetentionPage {
  protected readonly store = inject(RetentionStore);
  private readonly dialog = inject(HlmDialogService);
  private readonly confirm = inject(ConfirmDialogService);

  protected readonly running = signal(false);
  protected readonly pendingEnableId = signal<number | null>(null);

  protected openEditor(policy: RetentionPolicy | null): void {
    const context: PolicyDialogContext = {
      policy,
      signals: this.store.signalOptions(),
      allEventsPolicyId: this.store.allEventsPolicyId(),
      save: (input) => this.store.save(policy?.id ?? null, input),
    };
    this.dialog
      .open<RetentionPolicy>(PolicyDialog, { context, contentClass: 'sm:max-w-lg' })
      .closed$.subscribe((saved) => {
        if (saved) {
          toast.success(
            `Retention policy for "${policyTarget(saved)}" ${policy ? 'saved' : 'created'}`,
          );
        }
      });
  }

  protected async toggle({ policy, isEnabled }: PolicyToggle): Promise<void> {
    if (!isEnabled) {
      await this.store.setEnabled(policy, false);
      return;
    }
    this.pendingEnableId.set(policy.id);
    try {
      await this.confirm.confirm({
        title: 'Enable retention policy?',
        description: `${policy.signalId === null ? 'Events' : `Events matching "${policyTarget(policy)}"`} older than ${formatRetentionDays(policy.retentionDays)} will be permanently deleted on the next run.`,
        confirmLabel: 'Enable',
        action: () => this.store.setEnabled(policy, true),
      });
    } finally {
      this.pendingEnableId.set(null);
    }
  }

  protected confirmDelete(policy: RetentionPolicy): void {
    const target = policyTarget(policy);
    void this.confirm.confirm({
      title: `Delete the "${target}" policy?`,
      description:
        `Events covered by this policy will no longer expire automatically. ` +
        `Events already deleted by earlier runs cannot be restored.`,
      confirmLabel: 'Delete policy',
      action: () => this.store.remove(policy),
    });
  }

  protected async run(): Promise<void> {
    this.running.set(true);
    try {
      await this.store.run();
    } finally {
      this.running.set(false);
    }
  }
}
