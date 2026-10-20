import {
  formatPropertyValue,
  parsePropertyValue,
  propertiesToRows,
  propertyRowsError,
  rowsToProperties,
} from './applied-properties';

describe('applied properties mapping', () => {
  it('keeps JSON literal types and plain text', () => {
    expect(parsePropertyValue('42')).toBe(42);
    expect(parsePropertyValue(' true ')).toBe(true);
    expect(parsePropertyValue('null')).toBeNull();
    expect(parsePropertyValue('"42"')).toBe('42');
    expect(parsePropertyValue('{"a":1}')).toEqual({ a: 1 });
    expect(parsePropertyValue('Billing')).toBe('Billing');
    expect(parsePropertyValue('')).toBe('');
  });

  it('quotes strings that would read back as another type', () => {
    expect(formatPropertyValue('Billing')).toBe('Billing');
    expect(formatPropertyValue('42')).toBe('"42"');
    expect(formatPropertyValue('true')).toBe('"true"');
    expect(formatPropertyValue(42)).toBe('42');
    expect(formatPropertyValue(false)).toBe('false');
    expect(formatPropertyValue(null)).toBe('null');
    expect(formatPropertyValue({ a: 1 })).toBe('{"a":1}');
  });

  it('round-trips an object through editor rows', () => {
    const properties = { App: 'Billing', Version: '42', Port: 8080, Debug: false, Owner: null };
    const rows = propertiesToRows(properties);

    expect(rows).toEqual([
      { key: 'App', value: 'Billing' },
      { key: 'Version', value: '"42"' },
      { key: 'Port', value: '8080' },
      { key: 'Debug', value: 'false' },
      { key: 'Owner', value: 'null' },
    ]);
    expect(rowsToProperties(rows)).toEqual(properties);
  });

  it('maps missing properties to no rows', () => {
    expect(propertiesToRows(null)).toEqual([]);
    expect(propertiesToRows(undefined)).toEqual([]);
  });

  it('trims names and skips empty rows', () => {
    const rows = [
      { key: ' Env ', value: 'prod' },
      { key: '', value: '' },
    ];
    expect(rowsToProperties(rows)).toEqual({ Env: 'prod' });
  });

  it('reports duplicate names and values without a name', () => {
    expect(
      propertyRowsError([
        { key: 'A', value: '1' },
        { key: ' A', value: '2' },
      ]),
    ).toBe('Property "A" appears more than once.');
    expect(propertyRowsError([{ key: ' ', value: 'x' }])).toBe(
      'Every value needs a property name.',
    );
    expect(
      propertyRowsError([
        { key: 'A', value: '1' },
        { key: '', value: '' },
      ]),
    ).toBeNull();
  });
});
