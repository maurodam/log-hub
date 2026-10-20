import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideHistory,
  lucidePencil,
  lucideSend,
  lucideTrash2,
  lucideUsers,
} from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { DateTimePipe, TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { AlertsStore } from '../data-access/alerts-store';
import { Alert } from '../models/alert';
import { conditionSummary, formatSuppression } from '../models/condition-summary';

/** One alert: condition, status and actions. */
@Component({
  selector: 'app-alert-card',
  imports: [HlmButton, HlmSpinner, HlmSwitchImports, HlmTooltip, NgIcon, TimeAgoPipe, DateTimePipe],
  providers: [
    provideIcons({
      lucideCircleAlert,
      lucideHistory,
      lucidePencil,
      lucideSend,
      lucideTrash2,
      lucideUsers,
    }),
  ],
  host: {
    class:
      'bg-card ring-foreground/10 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ring-1 transition-opacity',
    '[class.opacity-70]': '!alert().isEnabled',
  },
  template: `
    <div class="pt-0.5">
      <hlm-switch
        [checked]="alert().isEnabled"
        [disabled]="!canChange()"
        [aria-label]="(alert().isEnabled ? 'Disable' : 'Enable') + ' alert ' + alert().title"
        (checkedChange)="toggle.emit($event)"
      />
    </div>

    <div class="grid min-w-0 flex-1 gap-1">
      <div class="flex min-w-0 items-baseline gap-2">
        <h3 class="truncate font-semibold">{{ alert().title }}</h3>
        @if (!alert().isEnabled) {
          <span class="text-muted-foreground text-xs">Disabled</span>
        }
      </div>
      <p class="font-mono text-xs leading-relaxed break-words">
        {{ summary() }}
        <span class="text-muted-foreground">· notify {{ quiet() }}</span>
      </p>
      @if (alert().description; as description) {
        <p class="text-muted-foreground line-clamp-2 text-xs">{{ description }}</p>
      }
      <p class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span class="inline-flex items-center gap-1" [hlmTooltip]="alert().recipients.join(', ')">
          <ng-icon name="lucideUsers" />
          {{ alert().recipients.length }}
          {{ alert().recipients.length === 1 ? 'recipient' : 'recipients' }}
        </span>
        <span>
          Last triggered:
          @if (alert().lastTriggeredDate; as triggered) {
            <span class="text-foreground" [hlmTooltip]="triggered | dateTime">{{
              triggered | timeAgo
            }}</span>
          } @else {
            never
          }
        </span>
        @if (alert().lastCheckedDate; as checked) {
          <span>
            Checked <span [hlmTooltip]="checked | dateTime">{{ checked | timeAgo }}</span>
          </span>
        }
      </p>
      @if (alert().lastError; as lastError) {
        <p
          class="text-destructive bg-destructive/5 mt-1 flex items-start gap-1.5 rounded-md px-2 py-1 text-xs"
          role="status"
        >
          <ng-icon name="lucideCircleAlert" class="mt-0.5 shrink-0" />
          <span class="break-words"
            ><span class="font-medium">Last error:</span> {{ lastError }}</span
          >
        </p>
      }
    </div>

    <div class="flex shrink-0 items-center gap-0.5">
      @if (canChange()) {
        <button
          hlmBtn
          variant="ghost"
          size="icon-sm"
          hlmTooltip="Send a test email"
          [attr.aria-label]="'Send a test email for ' + alert().title"
          [disabled]="testing() || !alert().recipients.length"
          (click)="runTest()"
        >
          @if (testing()) {
            <hlm-spinner />
          } @else {
            <ng-icon name="lucideSend" />
          }
        </button>
      }
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        hlmTooltip="Notification history"
        [attr.aria-label]="'Notification history of ' + alert().title"
        (click)="history.emit()"
      >
        <ng-icon name="lucideHistory" />
      </button>
      @if (canChange()) {
        <button
          hlmBtn
          variant="ghost"
          size="icon-sm"
          hlmTooltip="Edit"
          [attr.aria-label]="'Edit ' + alert().title"
          (click)="edit.emit()"
        >
          <ng-icon name="lucidePencil" />
        </button>
        <button
          hlmBtn
          variant="ghost"
          size="icon-sm"
          class="hover:text-destructive"
          hlmTooltip="Delete"
          [attr.aria-label]="'Delete ' + alert().title"
          (click)="remove.emit()"
        >
          <ng-icon name="lucideTrash2" />
        </button>
      }
    </div>
  `,
})
export class AlertCard {
  readonly alert = input.required<Alert>();
  readonly canChange = input(false);
  readonly toggle = output<boolean>();
  readonly edit = output();
  readonly history = output();
  readonly remove = output();

  private readonly store = inject(AlertsStore);
  protected readonly testing = signal(false);

  protected readonly summary = computed(() =>
    conditionSummary(this.alert(), {
      signal: this.store.signalTitle(this.alert().signalId),
      apiKey: (id) => this.store.apiKeyTitle(id),
    }),
  );
  protected readonly quiet = computed(() => formatSuppression(this.alert().suppressionMinutes));

  protected async runTest(): Promise<void> {
    this.testing.set(true);
    try {
      await this.store.test(this.alert());
    } finally {
      this.testing.set(false);
    }
  }
}
