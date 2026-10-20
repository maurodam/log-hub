import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../../core/auth/session.service';
import { Alert, AlertInput, LookupOption, toAlertInput } from '../models/alert';
import { AlertsApi } from './alerts.api';

interface SmtpStatus {
  isConfigured: boolean;
}

/** State of the alerts page. Provided by the page component. */
@Injectable()
export class AlertsStore {
  private readonly api = inject(AlertsApi);
  private readonly session = inject(SessionService);

  readonly canRead = computed(() => this.session.hasPermission('Read'));
  readonly canChange = computed(() => this.session.hasPermission('Project'));
  private readonly canSeeSmtp = computed(() => this.session.hasPermission('System'));

  readonly alerts = httpResource<Alert[]>(() => (this.canRead() ? this.api.alertsUrl : undefined));
  private readonly signalsResource = httpResource<LookupOption[]>(() =>
    this.canRead() ? this.api.signalsUrl : undefined,
  );
  private readonly apiKeysResource = httpResource<LookupOption[]>(() =>
    this.canRead() ? this.api.apiKeysUrl : undefined,
  );
  /** Only read with `System`; other users never see the SMTP banner. */
  private readonly smtp = httpResource<SmtpStatus>(() =>
    this.canSeeSmtp() ? this.api.smtpUrl : undefined,
  );

  readonly sortedAlerts = computed(() => {
    const list = this.alerts.hasValue() ? (this.alerts.value() ?? []) : [];
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  });

  readonly signals = computed(() => valueOf(this.signalsResource));
  readonly apiKeys = computed(() => valueOf(this.apiKeysResource));
  readonly lookupsLoading = computed(
    () => this.signalsResource.isLoading() || this.apiKeysResource.isLoading(),
  );

  readonly smtpMissing = computed(
    () => this.smtp.hasValue() && this.smtp.value()?.isConfigured === false,
  );

  private readonly signalTitles = computed(
    () => new Map(this.signals().map((option) => [option.id, option.title])),
  );
  private readonly apiKeyTitles = computed(
    () => new Map(this.apiKeys().map((option) => [option.id, option.title])),
  );

  signalTitle(id: number | null): string | null {
    if (id === null) return null;
    return this.signalTitles().get(id) ?? `signal #${id}`;
  }

  apiKeyTitle(id: number): string | undefined {
    return this.apiKeyTitles().get(id);
  }

  refreshLookups(): void {
    this.signalsResource.reload();
    this.apiKeysResource.reload();
  }

  /** Creates (`id` null) or updates an alert. Rejects with the HTTP error so the editor can show it. */
  async save(id: number | null, input: AlertInput): Promise<Alert> {
    const saved = await firstValueFrom(
      id === null ? this.api.create(input, true) : this.api.update(id, input, true),
    );
    this.upsert(saved);
    return saved;
  }

  /** Optimistic toggle; reverts when the server refuses. */
  async setEnabled(alert: Alert, isEnabled: boolean): Promise<void> {
    this.upsert({ ...alert, isEnabled });
    try {
      const saved = await firstValueFrom(
        this.api.update(alert.id, { ...toAlertInput(alert), isEnabled }),
      );
      this.upsert(saved);
      toast.success(`Alert "${saved.title}" ${isEnabled ? 'enabled' : 'disabled'}`);
    } catch {
      this.upsert(alert);
    }
  }

  /** Rejects on failure so the confirm dialog stays open. */
  async remove(alert: Alert): Promise<void> {
    await firstValueFrom(this.api.delete(alert.id));
    if (this.alerts.hasValue()) {
      this.alerts.update((list) => list?.filter((item) => item.id !== alert.id));
    }
    toast.success(`Alert "${alert.title}" deleted`);
  }

  async test(alert: Alert): Promise<void> {
    try {
      await firstValueFrom(this.api.test(alert.id));
      toast.success('Test email sent', {
        description: `${alert.recipients.length} ${alert.recipients.length === 1 ? 'recipient' : 'recipients'} of "${alert.title}"`,
      });
    } catch {
      // Reported by the HTTP error interceptor.
    }
  }

  private upsert(alert: Alert): void {
    if (!this.alerts.hasValue()) return;
    this.alerts.update((list = []) => {
      const index = list.findIndex((item) => item.id === alert.id);
      return index < 0 ? [...list, alert] : list.map((item, i) => (i === index ? alert : item));
    });
  }
}

function valueOf(resource: { hasValue(): boolean; value(): LookupOption[] | undefined }) {
  const list = resource.hasValue() ? (resource.value() ?? []) : [];
  return list.map(({ id, title }) => ({ id, title }));
}
