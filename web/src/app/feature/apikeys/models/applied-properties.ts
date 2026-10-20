/** One editable `name = value` row of an API key's applied properties. */
export interface PropertyRow {
  key: string;
  value: string;
}

/**
 * Text typed in a value box → stored value. JSON literals keep their type (`42`, `true`, `null`,
 * `{"a":1}`); `"42"` (quoted) is the string 42; anything else is a plain string.
 */
export function parsePropertyValue(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return text;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
}

/** Stored value → text for a value box; the inverse of `parsePropertyValue`. */
export function formatPropertyValue(value: unknown): string {
  if (typeof value === 'string') {
    // Quote strings that would otherwise be read back as another type ("42", "true").
    return parsePropertyValue(value) === value ? value : JSON.stringify(value);
  }
  return value === undefined ? '' : JSON.stringify(value);
}

/** `appliedProperties` object → editor rows, in key order of the object. */
export function propertiesToRows(
  properties: Record<string, unknown> | null | undefined,
): PropertyRow[] {
  return Object.entries(properties ?? {}).map(([key, value]) => ({
    key,
    value: formatPropertyValue(value),
  }));
}

/** Editor rows → `appliedProperties`. Rows without a name are skipped; names are trimmed. */
export function rowsToProperties(rows: readonly PropertyRow[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) properties[key] = parsePropertyValue(row.value);
  }
  return properties;
}

/** Validation message for the rows, or null when they are valid. */
export function propertyRowsError(rows: readonly PropertyRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      if (row.value.trim()) return 'Every value needs a property name.';
      continue;
    }
    if (seen.has(key)) return `Property "${key}" appears more than once.`;
    seen.add(key);
  }
  return null;
}
