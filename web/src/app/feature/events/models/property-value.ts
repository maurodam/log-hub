export type PropertyValueKind = 'string' | 'number' | 'boolean' | 'null' | 'json';

export interface DisplayValue {
  kind: PropertyValueKind;
  text: string;
}

/** How a property value is shown in the detail panel; objects and arrays are pretty-printed JSON. */
export function displayPropertyValue(value: unknown): DisplayValue {
  if (value === null || value === undefined) return { kind: 'null', text: 'null' };
  switch (typeof value) {
    case 'string':
      return { kind: 'string', text: value };
    case 'number':
    case 'bigint':
      return { kind: 'number', text: String(value) };
    case 'boolean':
      return { kind: 'boolean', text: String(value) };
    default:
      return { kind: 'json', text: JSON.stringify(value, null, 2) ?? String(value) };
  }
}
