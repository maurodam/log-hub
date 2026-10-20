import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideKeyRound,
  lucidePencil,
  lucideTrash2,
  lucideUserPlus,
  lucideUsers,
} from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../../core/auth/session.service';
import { errorMessage } from '../../../core/http/http-error';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog';
import { EmptyState } from '../../../shared/components/empty-state';
import { LoadError } from '../../../shared/components/load-error';
import { PageHeader } from '../../../shared/components/page-header';
import { ResetPasswordContext, ResetPasswordDialog } from '../components/reset-password-dialog';
import { UserFormContext, UserFormDialog } from '../components/user-form-dialog';
import { UsersApi } from '../data-access/users.api';
import { Role, User, userStatus, UserStatus } from '../models/user';

interface UserRow {
  user: User;
  roles: string[];
  status: UserStatus;
  isSelf: boolean;
}

const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  locked: 'Locked',
};

@Component({
  selector: 'app-users-page',
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
  providers: [
    provideIcons({ lucideKeyRound, lucidePencil, lucideTrash2, lucideUserPlus, lucideUsers }),
  ],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <app-page-header
      heading="Users"
      description="People who can sign in to LogHub and the roles they hold."
    >
      <button hlmBtn [disabled]="!roles.hasValue()" (click)="create()">
        <ng-icon name="lucideUserPlus" />
        New user
      </button>
    </app-page-header>

    @if (users.error() ?? roles.error(); as error) {
      <app-load-error title="Could not load users" [message]="message(error)" (retry)="reload()" />
    } @else if (users.hasValue() && rows().length === 0) {
      <app-empty-state
        icon="lucideUsers"
        title="No users"
        description="Create the first account."
      />
    } @else {
      <div hlmTableContainer class="rounded-lg border">
        <table hlmTable>
          <thead hlmTHead>
            <tr hlmTr>
              <th hlmTh>Username</th>
              <th hlmTh>Display name</th>
              <th hlmTh>Email</th>
              <th hlmTh>Provider</th>
              <th hlmTh>Roles</th>
              <th hlmTh>Status</th>
              <th hlmTh>Last login</th>
              <th hlmTh class="w-0"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @if (!loaded()) {
              @for (row of skeletonRows; track row) {
                <tr hlmTr>
                  @for (cell of skeletonCells; track cell) {
                    <td hlmTd><hlm-skeleton class="h-4 w-full max-w-28" /></td>
                  }
                </tr>
              }
            } @else {
              @for (row of rows(); track row.user.id) {
                <tr hlmTr>
                  <td hlmTd class="font-medium">
                    <span class="inline-flex items-center gap-2">
                      {{ row.user.username }}
                      @if (row.isSelf) {
                        <span hlmBadge variant="outline">You</span>
                      }
                    </span>
                  </td>
                  <td hlmTd>{{ row.user.displayName || '—' }}</td>
                  <td hlmTd class="text-muted-foreground">{{ row.user.email || '—' }}</td>
                  <td hlmTd>
                    {{
                      row.user.authProvider === 'Oidc' ? 'Single sign-on' : row.user.authProvider
                    }}
                  </td>
                  <td hlmTd>
                    <span class="flex flex-wrap gap-1">
                      @for (role of row.roles; track role) {
                        <span hlmBadge variant="secondary">{{ role }}</span>
                      } @empty {
                        <span class="text-muted-foreground text-xs">None</span>
                      }
                    </span>
                  </td>
                  <td hlmTd>
                    <span class="flex flex-wrap gap-1">
                      <span
                        hlmBadge
                        [variant]="row.status === 'active' ? 'outline' : 'destructive'"
                      >
                        {{ statusLabels[row.status] }}
                      </span>
                      @if (row.user.mustChangePassword) {
                        <span hlmBadge variant="outline">Password change due</span>
                      }
                    </span>
                  </td>
                  <td hlmTd class="text-muted-foreground tabular-nums">
                    {{
                      row.user.lastLoginDate
                        ? (row.user.lastLoginDate | date: 'yyyy-MM-dd HH:mm')
                        : 'Never'
                    }}
                  </td>
                  <td hlmTd>
                    <span class="flex justify-end gap-1">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon-sm"
                        hlmTooltip="Edit"
                        [attr.aria-label]="'Edit ' + row.user.username"
                        (click)="edit(row.user)"
                      >
                        <ng-icon name="lucidePencil" />
                      </button>
                      @if (row.user.authProvider === 'Local') {
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          hlmTooltip="Reset password"
                          [attr.aria-label]="'Reset password of ' + row.user.username"
                          (click)="resetPassword(row.user)"
                        >
                          <ng-icon name="lucideKeyRound" />
                        </button>
                      }
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon-sm"
                        class="hover:text-destructive"
                        [hlmTooltip]="row.isSelf ? 'You cannot delete yourself' : 'Delete'"
                        [attr.aria-label]="'Delete ' + row.user.username"
                        [disabled]="row.isSelf"
                        (click)="remove(row.user)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </span>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApi);
  private readonly session = inject(SessionService);
  private readonly dialog = inject(HlmDialogService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  protected readonly users = httpResource<User[]>(() => this.api.usersUrl);
  protected readonly roles = httpResource<Role[]>(() => this.api.rolesUrl);
  protected readonly loaded = computed(() => this.users.hasValue() && this.roles.hasValue());
  private readonly roleList = computed(() => (this.roles.hasValue() ? this.roles.value() : []));

  protected readonly rows = computed<UserRow[]>(() => {
    if (!this.users.hasValue()) return [];
    const roleTitles = new Map(this.roleList().map((role) => [role.id, role.title]));
    const selfId = this.session.user()?.id;
    const now = new Date();
    return [...this.users.value()]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((user) => ({
        user,
        roles: user.roleIds.map((id) => roleTitles.get(id) ?? `#${id}`),
        status: userStatus(user, now),
        isSelf: user.id === selfId,
      }));
  });

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly skeletonRows = [1, 2, 3];
  protected readonly skeletonCells = [1, 2, 3, 4, 5, 6, 7, 8];
  protected readonly message = errorMessage;

  protected reload(): void {
    this.users.reload();
    this.roles.reload();
  }

  protected async create(): Promise<void> {
    const created = await this.openForm(null);
    if (!created) return;
    this.users.reload();
    toast.success(`User ${created.username} created`);
  }

  protected async edit(user: User): Promise<void> {
    const saved = await this.openForm(user);
    if (!saved) return;
    this.users.reload();
    toast.success(`User ${saved.username} saved`);
    // Editing yourself can change your own roles and therefore your permissions.
    if (saved.id === this.session.user()?.id) void this.session.load();
  }

  protected async resetPassword(user: User): Promise<void> {
    const ref = this.dialog.open<boolean, ResetPasswordContext>(ResetPasswordDialog, {
      context: { user },
      contentClass: 'sm:max-w-md',
      closeOnOutsidePointerEvents: false,
    });
    if (!(await firstValueFrom(ref.closed$))) return;
    this.users.reload();
    toast.success(`Password of ${user.username} reset`);
  }

  protected async remove(user: User): Promise<void> {
    const deleted = await this.confirmDialog.confirm({
      title: 'Delete user?',
      description: `${user.username} loses access immediately. Signals and settings they own may be removed.`,
      confirmLabel: 'Delete user',
      action: () => firstValueFrom(this.api.delete(user.id)),
    });
    if (!deleted) return;
    this.users.reload();
    toast.success(`User ${user.username} deleted`);
  }

  private async openForm(user: User | null): Promise<User | undefined> {
    const ref = this.dialog.open<User, UserFormContext>(UserFormDialog, {
      context: { user, roles: this.roleList(), selfId: this.session.user()?.id ?? null },
      contentClass: 'sm:max-w-lg',
      closeOnOutsidePointerEvents: false,
    });
    return firstValueFrom(ref.closed$);
  }
}
