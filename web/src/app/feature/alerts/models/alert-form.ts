import { FilterSpec } from '../../../shared/models/filter-spec';
import { Alert, AlertInput } from './alert';
import { AlertLevel, normalizeLevels } from './alert-levels';

/** One `Name=Value` property filter row in the editor. */
export interface PropertyRow {
  name: string;
  value: string;
}

/** Editable state of the alert editor. */
export interface AlertDraft {
  title: string;
  description: string;
  signalId: number | null;
  text: string;
  levels: AlertLevel[];
  hasException: boolean;
  apiKeyIds: number[];
  properties: PropertyRow[];
  threshold: number | null;
  windowMinutes: number | null;
  suppressionMinutes: number | null;
  recipients: string[];
  isEnabled: boolean;
  /** Filter fields the editor does not show; kept as they are on save. */
  traceId: string | null;
  eventType: string | null;
}

export const WINDOW_PRESETS: readonly number[] = [5, 15, 60];
export const SUPPRESSION_PRESETS: readonly number[] = [0, 15, 60, 240, 1440];

export function emptyDraft(): AlertDraft {
  return {
    title: '',
    description: '',
    signalId: null,
    text: '',
    levels: [],
    hasException: false,
    apiKeyIds: [],
    properties: [],
    threshold: 1,
    windowMinutes: 5,
    suppressionMinutes: 60,
    recipients: [],
    isEnabled: true,
    traceId: null,
    eventType: null,
  };
}

/** Splits `Name=Value` at the first `=`. Entries without a name keep the whole text as name. */
export function parsePropertyEntry(entry: string): PropertyRow {
  const separator = entry.indexOf('=');
  return separator < 0
    ? { name: entry.trim(), value: '' }
    : { name: entry.slice(0, separator).trim(), value: entry.slice(separator + 1) };
}

export function draftFromAlert(alert: Alert): AlertDraft {
  const filter = alert.filter ?? {};
  return {
    title: alert.title,
    description: alert.description ?? '',
    signalId: alert.signalId,
    text: filter.text ?? '',
    levels: normalizeLevels(filter.levels),
    hasException: filter.hasException === true,
    apiKeyIds: [...(filter.apiKeyIds ?? [])],
    properties: (filter.properties ?? []).map(parsePropertyEntry),
    threshold: alert.threshold,
    windowMinutes: alert.windowMinutes,
    suppressionMinutes: alert.suppressionMinutes,
    recipients: [...alert.recipients],
    isEnabled: alert.isEnabled,
    traceId: filter.traceId ?? null,
    eventType: filter.eventType ?? null,
  };
}

/** Rows with a name; the value is kept verbatim (JSON literals such as `42` keep their type). */
function propertyEntries(rows: readonly PropertyRow[]): string[] {
  return rows
    .map((row) => ({ name: row.name.trim(), value: row.value.trim() }))
    .filter((row) => row.name)
    .map((row) => `${row.name}=${row.value}`);
}

/**
 * FilterSpec for the API. Empty parts are left out, so an editor without filters sends `{}`
 * (the alert then counts every event, or every event of its signal).
 */
export function buildFilterSpec(draft: AlertDraft): FilterSpec {
  const spec: FilterSpec = {};
  const text = draft.text.trim();
  if (text) spec.text = text;
  const levels = normalizeLevels(draft.levels);
  if (levels.length) spec.levels = levels;
  const properties = propertyEntries(draft.properties);
  if (properties.length) spec.properties = properties;
  if (draft.apiKeyIds.length) spec.apiKeyIds = [...new Set(draft.apiKeyIds)].sort((a, b) => a - b);
  if (draft.hasException) spec.hasException = true;
  if (draft.traceId) spec.traceId = draft.traceId;
  if (draft.eventType) spec.eventType = draft.eventType;
  return spec;
}

export function draftToInput(draft: AlertDraft): AlertInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    signalId: draft.signalId,
    filter: buildFilterSpec(draft),
    threshold: draft.threshold ?? 1,
    windowMinutes: draft.windowMinutes ?? 5,
    suppressionMinutes: draft.suppressionMinutes ?? 0,
    recipients: [...draft.recipients],
    isEnabled: draft.isEnabled,
  };
}

/** Message for an invalid property row, or null. */
export function propertyRowError(row: PropertyRow): string | null {
  const name = row.name.trim();
  if (!name && !row.value.trim()) return null;
  if (!name) return 'Enter a property name.';
  if (name.includes('=')) return 'Property names cannot contain "=".';
  return null;
}

/** Message for a whole number below `min`, or null. */
export function wholeNumberError(value: number | null, min: number, label: string): string | null {
  if (value === null || !Number.isInteger(value) || value < min) {
    return `${label} must be a whole number of at least ${min}.`;
  }
  return null;
}
