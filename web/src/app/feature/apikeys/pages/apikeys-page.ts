import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKeyRound, lucidePencil, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../../core/http/http-error';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state';
import { LoadError } from '../../../shared/components/load-error';
import { PageHeader } from '../../../shared/components/page-header';
import {
  ApiKeyFormContext,
  ApiKeyFormDialog,
  ApiKeyFormResult,
} from '../components/api-key-form-dialog';
import { ApiKeyTokenContext, ApiKeyTokenDialog } from '../components/api-key-token-dialog';
import { ApiKeysApi } from '../data-access/api-keys.api';
import { ApiKey } from '../models/api-key';
import { formatPropertyValue } from '../models/applied-properties';

@Component({
  selector: 'app-apikeys-page',
  imports: [
    DatePipe,
    EmptyState,
    HlmBadge,
    HlmButton,
    HlmSkeleton,
    HlmTableImports,
    HlmTooltip,
    LoadError,
    NgIcon,
    PageHeader,
  ],
  providers: [provideIcons({ lucideKeyRound, lucidePencil, lucidePlus, lucideTrash2 })],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <app-page-header
      heading="API keys"
      description="Keys identify the applications that send events and the scripts that read them."
    >
      <button hlmBtn (click)="create()">
        <ng-icon name="lucidePlus" />
        New API key
      </button>
    </app-page-header>

    @if (keys.error(); as error) {
      <app-load-error
        title="Could not load API keys"
        [message]="message(error)"
        (retry)="keys.reload()"
      />
    } @else if (keys.hasValue() && rows().length === 0) {
      <app-empty-state
        icon="lucideKeyRound"
        title="No API keys yet"
        description="Create a key for each application so you can tell their events apart and control what they may send."
      >
        <button hlmBtn class="mt-2" (click)="create()">
          <ng-icon name="lucidePlus" />
          New API key
        </button>
      </app-empty-state>
    } @else {
      <div hlmTableContainer class="rounded-lg border">
        <table hlmTable>
          <thead hlmTHead>
            <tr hlmTr>
              <th hlmTh>Title</th>
              <th hlmTh>Token</th>
              <th hlmTh>Permissions</th>
              <th hlmTh>Minimum level</th>
              <th hlmTh>Applied properties</th>
              <th hlmTh>Created</th>
              <th hlmTh class="w-0"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @if (!keys.hasValue()) {
              @for (row of skeletonRows; track row) {
                <tr hlmTr>
                  @for (cell of skeletonCells; track cell) {
                    <td hlmTd><hlm-skeleton class="h-4 w-full max-w-32" /></td>
                  }
                </tr>
              }
            }
            @for (key of rows(); track key.id) {
              <tr hlmTr>
                <td hlmTd class="font-medium">
                  <span class="inline-flex items-center gap-2">
                    {{ key.title }}
                    @if (key.isDefault) {
                      <span hlmBadge variant="outline">Default</span>
                    }
                  </span>
                </td>
                <td hlmTd>
                  @if (key.tokenPrefix) {
                    <code class="text-muted-foreground text-xs">{{ key.tokenPrefix }}…</code>
                  } @else {
                    <span class="text-muted-foreground">—</span>
                  }
                </td>
                <td hlmTd>
                  <span class="flex flex-wrap gap-1">
                    @for (permission of key.permissions; track permission) {
                      <span hlmBadge variant="secondary">{{ permission }}</span>
                    } @empty {
                      <span class="text-muted-foreground text-xs">None</span>
                    }
                  </span>
                </td>
                <td hlmTd>
                  @if (key.minimumLevel; as level) {
                    {{ level }}
                  } @else {
                    <span class="text-muted-foreground">Any</span>
                  }
                </td>
                <td hlmTd>
                  <span class="flex max-w-80 flex-wrap gap-1">
                    @for (property of properties(key); track property) {
                      <code class="bg-muted rounded px-1.5 py-0.5 text-xs">{{ property }}</code>
                    } @empty {
                      <span class="text-muted-foreground">—</span>
                    }
                  </span>
                </td>
                <td hlmTd class="text-muted-foreground tabular-nums">
                  {{ key.createdDate | date: 'yyyy-MM-dd HH:mm' }}
                </td>
                <td hlmTd>
                  <span class="flex justify-end gap-1">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      hlmTooltip="Edit"
                      [attr.aria-label]="'Edit ' + key.title"
                      (click)="edit(key)"
                    >
                      <ng-icon name="lucidePencil" />
                    </button>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      class="hover:text-destructive"
                      [hlmTooltip]="key.isDefault ? 'The default key cannot be deleted' : 'Delete'"
                      [attr.aria-label]="'Delete ' + key.title"
                      [disabled]="key.isDefault"
                      (click)="remove(key)"
                    >
                      <ng-icon name="lucideTrash2" />
                    </button>
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class ApiKeysPage {
  private readonly api = inject(ApiKeysApi);
  private readonly dialog = inject(HlmDialogService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  protected readonly keys = httpResource<ApiKey[]>(() => this.api.baseUrl);
  protected readonly rows = computed(() =>
    this.keys.hasValue()
      ? [...this.keys.value()].sort((a, b) => a.title.localeCompare(b.title))
      : [],
  );
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly skeletonCells = [1, 2, 3, 4, 5, 6, 7];
  protected readonly message = errorMessage;

  protected properties(key: ApiKey): string[] {
    return Object.entries(key.appliedProperties ?? {}).map(
      ([name, value]) => `${name}=${formatPropertyValue(value)}`,
    );
  }

  protected async create(): Promise<void> {
    const result = await this.openForm(null);
    if (result?.kind !== 'created') return;
    this.keys.reload();
    toast.success('API key created');
    const { apiKey, token } = result.created;
    this.dialog.open<void, ApiKeyTokenContext>(ApiKeyTokenDialog, {
      context: { title: apiKey.title, token },
      contentClass: 'sm:max-w-2xl',
      closeOnOutsidePointerEvents: false,
    });
  }

  protected async edit(key: ApiKey): Promise<void> {
    const result = await this.openForm(key);
    if (result?.kind !== 'updated') return;
    this.keys.reload();
    toast.success('API key saved');
  }

  protected async remove(key: ApiKey): Promise<void> {
    const deleted = await this.confirmDialog.confirm({
      title: 'Delete API key?',
      description: `"${key.title}" stops working immediately. Applications using it can no longer send or read events.`,
      confirmLabel: 'Delete key',
      action: () => firstValueFrom(this.api.delete(key.id)),
    });
    if (!deleted) return;
    this.keys.reload();
    toast.success('API key deleted');
  }

  private async openForm(apiKey: ApiKey | null): Promise<ApiKeyFormResult | undefined> {
    const ref = this.dialog.open<ApiKeyFormResult, ApiKeyFormContext>(ApiKeyFormDialog, {
      context: { apiKey },
      contentClass: 'sm:max-w-lg',
      closeOnOutsidePointerEvents: false,
    });
    return firstValueFrom(ref.closed$);
  }
}
