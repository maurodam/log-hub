/** Exact-match filter on a top-level event property, sent to the API as `Name=Value`. */
export interface PropertyFilter {
  name: string;
  /** Value as written after `=`: `42`, `true`, `null` are JSON literals, anything else a string. */
  value: string;
}

const JSON_LITERAL = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)$/;

/**
 * Converts a property value into the text used after `=`.
 * Returns null for values that cannot be matched exactly (objects and arrays).
 * Strings that would be read back as a JSON literal (or start with a quote) are JSON-quoted
 * so that e.g. the string "42" does not turn into the number 42.
 */
export function formatPropertyFilterValue(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') {
    return JSON_LITERAL.test(value) || value.startsWith('"') ? JSON.stringify(value) : value;
  }
  return null;
}

export function formatPropertyFilter(filter: PropertyFilter): string {
  return `${filter.name}=${filter.value}`;
}

/** Parses `Name=Value` (split at the first `=`). Returns null when the name is empty or `=` is missing. */
export function parsePropertyFilter(text: string): PropertyFilter | null {
  const separator = text.indexOf('=');
  if (separator <= 0) return null;
  const name = text.slice(0, separator).trim();
  return name ? { name, value: text.slice(separator + 1) } : null;
}

export function samePropertyFilter(a: PropertyFilter, b: PropertyFilter): boolean {
  return a.name === b.name && a.value === b.value;
}
