import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLock, lucideMail, lucideServerCog, lucideTriangleAlert } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { SessionService } from '../../../core/auth/session.service';
import { EmptyState } from '../../../shared/components/empty-state';
import { SmtpForm } from '../components/smtp-form';
import { TestEmailCard } from '../components/test-email-card';
import { SmtpApi } from '../data-access/smtp.api';
import { SmtpSettings } from '../models/smtp-settings';

@Component({
  selector: 'app-email-settings-page',
  imports: [
    EmptyState,
    HlmAlertImports,
    HlmBadge,
    HlmButton,
    HlmSkeleton,
    NgIcon,
    SmtpForm,
    TestEmailCard,
  ],
  providers: [provideIcons({ lucideLock, lucideMail, lucideServerCog, lucideTriangleAlert })],
  host: { class: 'mx-auto flex w-full max-w-3xl flex-col gap-4' },
  template: `
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          Email
          @if (current(); as settings) {
            @if (settings.isConfigured) {
              <span hlmBadge class="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
                Configured
              </span>
            } @else {
              <span hlmBadge variant="outline" class="text-muted-foreground">
                <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
                Not configured
              </span>
            }
            @if (settings.isFromEnvironment) {
              <span hlmBadge variant="secondary">
                <ng-icon name="lucideServerCog" />
                Environment
              </span>
            }
          }
        </h2>
        <p class="text-muted-foreground text-sm">
          Outgoing mail server used for alert notifications.
        </p>
      </div>
    </header>

    @if (!canManage()) {
      <app-empty-state
        icon="lucideMail"
        title="Email settings need the System permission"
        description="Ask an administrator to configure the SMTP server."
      />
    } @else if (settings.error()) {
      <div hlmAlert variant="destructive">
        <ng-icon name="lucideTriangleAlert" />
        <h3 hlmAlertTitle>Could not load the email settings</h3>
        <p hlmAlertDescription>Check the connection to the server and try again.</p>
        <button hlmAlertAction hlmBtn size="sm" variant="outline" (click)="settings.reload()">
          Retry
        </button>
      </div>
    } @else if (current(); as current) {
      @if (current.isFromEnvironment) {
        <div hlmAlert>
          <ng-icon name="lucideLock" />
          <h3 hlmAlertTitle>Read-only: configured by environment variables</h3>
          <p hlmAlertDescription>
            The server sets these values with <code class="font-mono text-xs">Smtp__*</code>
            environment variables. Change them in the deployment and restart LogHub.
          </p>
        </div>
      }
      <app-smtp-form
        [settings]="current"
        [readOnly]="current.isFromEnvironment"
        (saved)="settings.set($event)"
      />
      <app-test-email-card [configured]="current.isConfigured" />
    } @else {
      <div class="grid gap-3" aria-busy="true" aria-label="Loading email settings">
        <hlm-skeleton class="h-80 w-full rounded-xl" />
        <hlm-skeleton class="h-36 w-full rounded-xl" />
      </div>
    }
  `,
})
export class EmailSettingsPage {
  private readonly api = inject(SmtpApi);
  private readonly session = inject(SessionService);

  protected readonly canManage = computed(() => this.session.hasPermission('System'));
  protected readonly settings = httpResource<SmtpSettings>(() =>
    this.canManage() ? this.api.settingsUrl : undefined,
  );
  protected readonly current = computed(() =>
    this.settings.hasValue() ? (this.settings.value() ?? null) : null,
  );
}
