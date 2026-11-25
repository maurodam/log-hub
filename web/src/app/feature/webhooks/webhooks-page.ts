import { HttpClient, httpResource } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/config/app-config';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog';
import { WebhookDestination } from '../alerts/models/alert';

@Component({
  imports: [FormsModule, HlmButton, HlmInput],
  host: { class: 'mx-auto grid w-full max-w-4xl gap-5' },
  template: `
    <header>
      <h2 class="text-lg font-semibold">Webhooks</h2>
      <p class="text-muted-foreground text-sm">Manage destinations that alert rules can use.</p>
    </header>

    @if (destinations.error()) {
      <p role="alert">Could not load webhook destinations.</p>
      <button hlmBtn variant="outline" (click)="destinations.reload()">Retry</button>
    } @else if (destinations.isLoading() && !destinations.hasValue()) {
      <p role="status">Loading destinations…</p>
    } @else if (destinations.hasValue()) {
      <ul class="divide-y rounded-lg border">
        @for (item of destinations.value(); track item.id) {
          <li class="flex flex-wrap items-center justify-between gap-2 p-3">
            <div class="min-w-0">
              <p class="break-words font-medium">{{ item.name }}</p>
              <p class="text-muted-foreground text-sm">
                {{ item.kind }} · {{ item.enabled ? 'Enabled' : 'Disabled' }}
              </p>
            </div>
            <div class="flex gap-2">
              <button hlmBtn variant="outline" size="sm" (click)="edit(item)">
                Edit<span class="sr-only"> {{ item.name }}</span>
              </button>
              <button hlmBtn variant="outline" size="sm" (click)="remove(item)">
                Delete<span class="sr-only"> {{ item.name }}</span>
              </button>
            </div>
          </li>
        } @empty {
          <li class="text-muted-foreground p-3 text-sm">No webhook destinations configured.</li>
        }
      </ul>
    }

    <form #editor="ngForm" class="grid max-w-xl gap-3 rounded-lg border p-4" (ngSubmit)="save()">
      <h3 class="font-semibold">{{ editing() ? 'Edit destination' : 'Add destination' }}</h3>
      <label class="grid gap-1 text-sm"
        >Name
        <input hlmInput name="name" [(ngModel)]="name" maxlength="100" required />
      </label>
      <label class="grid gap-1 text-sm"
        >Type
        <select class="bg-background rounded-md border px-3 py-2" name="kind" [(ngModel)]="kind">
          <option value="teams">Teams Workflows</option>
          <option value="slack">Slack Incoming Webhook</option>
          <option value="generic">Generic HTTPS</option>
        </select>
      </label>
      <label class="grid gap-1 text-sm"
        >Webhook URL
        <input
          hlmInput
          type="password"
          name="url"
          [(ngModel)]="url"
          autocomplete="new-password"
          [required]="!editing() || kind !== editing()?.kind"
          maxlength="4096"
        />
      </label>
      @if (kind === 'generic') {
        <label class="grid gap-1 text-sm"
          >Signing secret
          <input
            hlmInput
            type="password"
            name="secret"
            [(ngModel)]="secret"
            autocomplete="new-password"
            minlength="32"
            maxlength="512"
            [required]="editing()?.kind !== 'generic'"
          />
        </label>
      }
      @if (editing()?.kind === kind) {
        <p class="text-muted-foreground text-sm">
          Leave credentials blank to keep the stored values.
        </p>
      }
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" [(ngModel)]="enabled" /> Enabled
      </label>
      <div class="flex gap-2">
        <button hlmBtn type="submit" [disabled]="editor.invalid || saving()">
          {{ editing() ? 'Save changes' : 'Add destination' }}
        </button>
        @if (editing()) {
          <button hlmBtn type="button" variant="outline" (click)="edit(null)">Cancel</button>
        }
      </div>
      <p class="text-muted-foreground text-sm" role="status">{{ status() }}</p>
    </form>
  `,
})
export class WebhooksPage {
  private readonly http = inject(HttpClient);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly endpoint = `${inject(API_BASE_URL)}/v1/settings/webhooks`;
  protected readonly destinations = httpResource<WebhookDestination[]>(() => this.endpoint);
  protected readonly editing = signal<WebhookDestination | null>(null);
  protected readonly saving = signal(false);
  protected readonly status = signal('');
  protected name = '';
  protected kind: WebhookDestination['kind'] = 'teams';
  protected url = '';
  protected secret = '';
  protected enabled = true;

  protected edit(item: WebhookDestination | null): void {
    this.editing.set(item);
    this.name = item?.name ?? '';
    this.kind = item?.kind ?? 'teams';
    this.enabled = item?.enabled ?? true;
    this.url = '';
    this.secret = '';
    this.status.set('');
  }

  protected async save(): Promise<void> {
    const existing = this.editing();
    const body = {
      name: this.name,
      kind: this.kind,
      enabled: this.enabled,
      url: this.url.trim() || null,
      signingSecret: this.kind === 'generic' ? this.secret || null : null,
    };
    this.saving.set(true);
    this.status.set('');
    try {
      await firstValueFrom(
        existing
          ? this.http.put(`${this.endpoint}/${existing.id}`, body)
          : this.http.post(this.endpoint, body),
      );
      this.edit(null);
      this.status.set('Destination saved.');
      this.destinations.reload();
    } catch {
      // The HTTP error interceptor shows the server message.
    } finally {
      this.saving.set(false);
    }
  }

  protected remove(item: WebhookDestination): void {
    void this.confirm.confirm({
      title: `Delete “${item.name}”?`,
      description:
        'This cancels pending deliveries and stops future deliveries to this destination.',
      confirmLabel: 'Delete destination',
      action: async () => {
        await firstValueFrom(this.http.delete(`${this.endpoint}/${item.id}`));
        if (this.editing()?.id === item.id) this.edit(null);
        this.destinations.reload();
      },
    });
  }
}
