import { LogSignal } from '../../../shared/models/signal';

export interface SignalGroup {
  /** null = signals without a group (each one combines with AND). */
  name: string | null;
  signals: LogSignal[];
}

/** Explains how the server combines selected signals. */
export const SIGNAL_COMBINATION_HINT =
  'Signals in the same group combine with OR; signals in different groups (or without a group) combine with AND.';

/** Trimmed group name; blank = no group. */
export function normalizeGroupName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/** Case-insensitive order; ties broken case-sensitively so the result is deterministic. */
const byText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);

/**
 * Signals grouped for the panel: named groups alphabetically, then the ungrouped ones; signals
 * sorted by title. `query` keeps signals whose title, description or group contains it.
 */
export function groupSignals(signals: readonly LogSignal[], query = ''): SignalGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string | null, LogSignal[]>();
  for (const signal of signals) {
    const group = normalizeGroupName(signal.groupName);
    if (needle) {
      const haystack = `${signal.title}\n${signal.description ?? ''}\n${group ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    const members = groups.get(group) ?? [];
    members.push(signal);
    groups.set(group, members);
  }
  const named = [...groups.keys()].filter((name): name is string => name !== null).sort(byText);
  const ordered: (string | null)[] = groups.has(null) ? [...named, null] : named;
  return ordered.map((name) => ({
    name,
    signals: [...(groups.get(name) ?? [])].sort((a, b) => byText(a.title, b.title)),
  }));
}

/** Distinct group names, sorted: suggestions for the save dialog. */
export function signalGroupNames(signals: readonly LogSignal[]): string[] {
  const names = new Set<string>();
  for (const signal of signals) {
    const name = normalizeGroupName(signal.groupName);
    if (name) names.add(name);
  }
  return [...names].sort(byText);
}

/** Adds or removes `id`; result sorted so equal selections serialize the same way. */
export function toggleId(ids: readonly number[], id: number): number[] {
  const next = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  return next.sort((a, b) => a - b);
}

/**
 * Readable form of the selection, e.g. `(Errors OR Warnings) AND Billing`.
 * Mirrors the server rule: same group = OR, different groups or no group = AND.
 */
export function describeCombination(selected: readonly LogSignal[]): string {
  const clauses: string[][] = [];
  const byGroup = new Map<string, string[]>();
  for (const signal of selected) {
    const group = normalizeGroupName(signal.groupName);
    if (group === null) {
      clauses.push([signal.title]);
      continue;
    }
    let clause = byGroup.get(group);
    if (!clause) {
      clause = [];
      byGroup.set(group, clause);
      clauses.push(clause);
    }
    clause.push(signal.title);
  }
  const many = clauses.length > 1;
  return clauses
    .map((titles) => (titles.length > 1 && many ? `(${titles.join(' OR ')})` : titles.join(' OR ')))
    .join(' AND ');
}

export interface SignalPermissions {
  write: boolean;
  project: boolean;
}

/** Who may edit or delete a signal: own with Write, shared with Project; never built-in ones. */
export function canManageSignal(signal: LogSignal, permissions: SignalPermissions): boolean {
  if (signal.isProtected) return false;
  return (signal.isOwn && permissions.write) || (signal.isShared && permissions.project);
}
