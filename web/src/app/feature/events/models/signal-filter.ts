import { FilterSpec } from '../../../shared/models/filter-spec';
import { EventFilter, normalizeIds } from './event-filter';
import { normalizeLevels } from './log-level';
import { formatPropertyFilter } from './property-filter';

/**
 * FilterSpec saved by "Save as signal": the toolbar filters without the time range and without
 * the selected signals (a signal cannot contain other signals). Unset fields are left out.
 */
export function filterSpecFromEventFilter(filter: EventFilter): FilterSpec {
  const spec: FilterSpec = {};
  const text = filter.text.trim();
  if (text) spec.text = text;
  const levels = normalizeLevels(filter.levels);
  if (levels.length) spec.levels = levels;
  if (filter.properties.length) spec.properties = filter.properties.map(formatPropertyFilter);
  const apiKeyIds = normalizeIds(filter.apiKeys);
  if (apiKeyIds.length) spec.apiKeyIds = apiKeyIds;
  if (filter.hasException) spec.hasException = true;
  if (filter.traceId.trim()) spec.traceId = filter.traceId.trim();
  if (filter.eventType.trim()) spec.eventType = filter.eventType.trim();
  return spec;
}

export function isEmptyFilterSpec(spec: FilterSpec): boolean {
  return describeFilterSpec(spec, String).length === 0;
}

export interface FilterSpecPart {
  label: string;
  value: string;
}

/** Human-readable parts of a FilterSpec, in a stable order, for summaries and chips. */
export function describeFilterSpec(
  spec: FilterSpec,
  apiKeyTitle: (id: number) => string,
): FilterSpecPart[] {
  const parts: FilterSpecPart[] = [];
  if (spec.text?.trim()) parts.push({ label: 'text', value: spec.text.trim() });
  if (spec.levels?.length) parts.push({ label: 'levels', value: spec.levels.join(', ') });
  for (const property of spec.properties ?? []) parts.push({ label: 'property', value: property });
  if (spec.apiKeyIds?.length) {
    parts.push({ label: 'API keys', value: spec.apiKeyIds.map(apiKeyTitle).join(', ') });
  }
  if (spec.hasException) parts.push({ label: 'exception', value: 'yes' });
  if (spec.traceId?.trim()) parts.push({ label: 'trace', value: spec.traceId.trim() });
  if (spec.eventType?.trim()) parts.push({ label: 'type', value: spec.eventType.trim() });
  return parts;
}
