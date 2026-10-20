import { Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDatabase, lucideFilter, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import { DateTimePipe, TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { policyTarget, RetentionPolicy } from '../models/retention';
import { formatCount, formatRetentionDays } from '../models/retention-format';

export interface PolicyToggle {
  policy: RetentionPolicy;
  isEnabled: boolean;
}

/** Retention policies with inline enable switch and edit/delete actions. */
@Component({
  selector: 'app-policy-table',
  imports: [
    HlmBadge,
    HlmButton,
    HlmSwitchImports,
    HlmTableImports,
    HlmTooltip,
    NgIcon,
    TimeAgoPipe,
    DateTimePipe,
  ],
  providers: [provideIcons({ lucideDatabase, lucideFilter, lucidePencil, lucideTrash2 })],
  template: `
    <div hlmTableContainer>
      <table hlmTable>
        <thead hlmTHead>
          <tr hlmTr>
            <th hlmTh class="ps-4">Target</th>
            <th hlmTh>Keep for</th>
            <th hlmTh>Enabled</th>
            <th hlmTh>Last run</th>
            <th hlmTh class="text-end">Last deleted</th>
            <th hlmTh class="pe-4 text-end"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody hlmTBody>
          @for (policy of policies(); track policy.id) {
            <tr hlmTr [class.opacity-60]="!policy.isEnabled">
              <td hlmTd class="ps-4">
                <span class="flex items-center gap-2 font-medium">
                  <ng-icon
                    [name]="policy.signalId === null ? 'lucideDatabase' : 'lucideFilter'"
                    class="text-muted-foreground"
                    aria-hidden="true"
                  />
                  {{ target(policy) }}
                  @if (policy.signalId === null) {
                    <span hlmBadge variant="secondary">whole days</span>
                  }
                  @if (policy.isManagedByEnvironment) {
                    <span hlmBadge variant="outline" hlmTooltip="Set by Retention__DefaultDays. Change the environment variable to edit it.">
                      Environment
                    </span>
                  }
                </span>
              </td>
              <td hlmTd>{{ days(policy.retentionDays) }}</td>
              <td hlmTd>
                <hlm-switch
                  size="sm"
                  [checked]="policy.isEnabled || pendingEnableId() === policy.id"
                  [disabled]="!canManage() || policy.isManagedByEnvironment"
                  [aria-label]="'Enable policy for ' + target(policy)"
                  (checkedChange)="toggle.emit({ policy, isEnabled: $event })"
                />
              </td>
              <td hlmTd>
                @if (policy.lastRunDate; as lastRun) {
                  <span [hlmTooltip]="lastRun | dateTime">{{ lastRun | timeAgo }}</span>
                } @else {
                  <span class="text-muted-foreground">Never</span>
                }
              </td>
              <td hlmTd class="text-end font-mono tabular-nums">
                {{ policy.lastDeletedCount === null ? '—' : count(policy.lastDeletedCount) }}
              </td>
              <td hlmTd class="pe-4 text-end">
                @if (canManage() && !policy.isManagedByEnvironment) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    hlmTooltip="Edit"
                    [attr.aria-label]="'Edit policy for ' + target(policy)"
                    (click)="edit.emit(policy)"
                  >
                    <ng-icon name="lucidePencil" />
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    class="hover:text-destructive"
                    hlmTooltip="Delete"
                    [attr.aria-label]="'Delete policy for ' + target(policy)"
                    (click)="remove.emit(policy)"
                  >
                    <ng-icon name="lucideTrash2" />
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class PolicyTable {
  readonly policies = input.required<readonly RetentionPolicy[]>();
  readonly canManage = input(false);
  /** Policy whose enable switch waits for confirmation (shown as on until answered). */
  readonly pendingEnableId = input<number | null>(null);
  readonly edit = output<RetentionPolicy>();
  readonly remove = output<RetentionPolicy>();
  readonly toggle = output<PolicyToggle>();

  protected readonly target = policyTarget;
  protected readonly days = formatRetentionDays;
  protected readonly count = formatCount;
}
