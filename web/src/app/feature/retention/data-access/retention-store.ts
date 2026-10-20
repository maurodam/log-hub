import { httpResource } from '@angular/common/http';
import { computed, inject, Injectable } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../../../core/auth/session.service';
import {
  policyTarget,
  RetentionPolicy,
  RetentionPolicyInput,
  SignalOption,
  StorageInfo,
  toPolicyInput,
} from '../models/retention';
import { RetentionApi } from './retention.api';

/** State of the retention page. Provided by the page component. */
@Injectable()
export class RetentionStore {
  private readonly api = inject(RetentionApi);
  private readonly session = inject(SessionService);

  readonly canManage = computed(() => this.session.hasPermission('Project'));

  readonly policies = httpResource<RetentionPolicy[]>(() =>
    this.canManage() ? this.api.policiesUrl : undefined,
  );
  readonly storage = httpResource<StorageInfo>(() =>
    this.canManage() ? this.api.storageUrl : undefined,
  );
  readonly signals = httpResource<SignalOption[]>(() =>
    this.canManage() ? this.api.signalsUrl : undefined,
  );

  /** All-events policy first, then signal policies by title. */
  readonly sortedPolicies = computed(() => {
    const list = this.policies.hasValue() ? (this.policies.value() ?? []) : [];
    return [...list].sort(
      (a, b) =>
        Number(a.signalId !== null) - Number(b.signalId !== null) ||
        policyTarget(a).localeCompare(policyTarget(b)),
    );
  });

  readonly signalOptions = computed(() =>
    this.signals.hasValue() ? (this.signals.value() ?? []) : [],
  );

  readonly allEventsPolicyId = computed(
    () => this.sortedPolicies().find((policy) => policy.signalId === null)?.id ?? null,
  );

  refresh(): void {
    this.policies.reload();
    this.storage.reload();
  }

  /** Creates (`id` null) or updates a policy. Rejects with the HTTP error so dialogs can show it. */
  async save(id: number | null, input: RetentionPolicyInput): Promise<RetentionPolicy> {
    const saved = await firstValueFrom(
      id === null ? this.api.create(input, true) : this.api.update(id, input, true),
    );
    this.upsert(saved);
    return saved;
  }

  /** Optimistic toggle; reverts when the server refuses. */
  async setEnabled(policy: RetentionPolicy, isEnabled: boolean): Promise<void> {
    this.upsert({ ...policy, isEnabled });
    try {
      const saved = await firstValueFrom(
        this.api.update(policy.id, { ...toPolicyInput(policy), isEnabled }),
      );
      this.upsert(saved);
      toast.success(`${policyTarget(saved)}: policy ${isEnabled ? 'enabled' : 'disabled'}`);
    } catch {
      this.upsert(policy);
    }
  }

  /** Rejects on failure (the HTTP error interceptor reports it) so confirm dialogs stay open. */
  async remove(policy: RetentionPolicy): Promise<void> {
    await firstValueFrom(this.api.delete(policy.id));
    if (this.policies.hasValue()) {
      this.policies.update((list) => list?.filter((item) => item.id !== policy.id));
    }
    toast.success(`Retention policy for "${policyTarget(policy)}" deleted`);
  }

  async run(): Promise<void> {
    try {
      await firstValueFrom(this.api.run());
      toast.success('Retention started', {
        description: 'Old events are removed in the background. Refresh to see the results.',
      });
    } catch {
      // Reported by the HTTP error interceptor.
    }
  }

  private upsert(policy: RetentionPolicy): void {
    if (!this.policies.hasValue()) return;
    this.policies.update((list = []) => {
      const index = list.findIndex((item) => item.id === policy.id);
      return index < 0 ? [...list, policy] : list.map((item, i) => (i === index ? policy : item));
    });
  }
}
