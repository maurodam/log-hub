/** `RetentionPolicy` (docs/api/v1.md, Retention). `signalId = null` is the all-events policy. */
export interface RetentionPolicy {
  id: number;
  signalId: number | null;
  signalTitle: string | null;
  retentionDays: number;
  isEnabled: boolean;
  lastRunDate: string | null;
  lastDeletedCount: number | null;
  /** Set by the Retention__DefaultDays environment variable: read-only here. */
  isManagedByEnvironment: boolean;
}

/** Body of POST and PUT `/retention`. */
export interface RetentionPolicyInput {
  signalId: number | null;
  retentionDays: number;
  isEnabled: boolean;
}

export interface StoragePartition {
  name: string;
  from: string;
  to: string;
  /** Estimate. */
  rows: number;
  bytes: number;
}

/** GET `/retention/storage`. */
export interface StorageInfo {
  totalEvents: number;
  totalBytes: number;
  oldestEvent: string | null;
  partitions: StoragePartition[];
}

/** Item of GET `/signals`, reduced to what the policy editor needs. */
export interface SignalOption {
  id: number;
  title: string;
}

export function toPolicyInput(policy: RetentionPolicy): RetentionPolicyInput {
  return {
    signalId: policy.signalId,
    retentionDays: policy.retentionDays,
    isEnabled: policy.isEnabled,
  };
}

export function policyTarget(policy: RetentionPolicy): string {
  if (policy.signalId === null) return 'All events';
  return policy.signalTitle ?? `Signal #${policy.signalId}`;
}
