import {
  formatPropertyFilter,
  formatPropertyFilterValue,
  parsePropertyFilter,
} from './property-filter';

describe('formatPropertyFilterValue', () => {
  it('writes numbers, booleans and null as JSON literals', () => {
    expect(formatPropertyFilterValue(42)).toBe('42');
    expect(formatPropertyFilterValue(-1.5)).toBe('-1.5');
    expect(formatPropertyFilterValue(true)).toBe('true');
    expect(formatPropertyFilterValue(false)).toBe('false');
    expect(formatPropertyFilterValue(null)).toBe('null');
  });

  it('writes ordinary strings as they are', () => {
    expect(formatPropertyFilterValue('acme')).toBe('acme');
    expect(formatPropertyFilterValue('GET /api/orders?id=1')).toBe('GET /api/orders?id=1');
    expect(formatPropertyFilterValue('')).toBe('');
  });

  it('quotes strings that would otherwise read as a JSON literal', () => {
    expect(formatPropertyFilterValue('42')).toBe('"42"');
    expect(formatPropertyFilterValue('true')).toBe('"true"');
    expect(formatPropertyFilterValue('null')).toBe('"null"');
    expect(formatPropertyFilterValue('"quoted"')).toBe('"\\"quoted\\""');
  });

  it('cannot filter on objects, arrays or non-finite numbers', () => {
    expect(formatPropertyFilterValue({ a: 1 })).toBeNull();
    expect(formatPropertyFilterValue([1, 2])).toBeNull();
    expect(formatPropertyFilterValue(Number.NaN)).toBeNull();
    expect(formatPropertyFilterValue(undefined)).toBeNull();
  });
});

describe('property filter text', () => {
  it('formats as Name=Value', () => {
    expect(formatPropertyFilter({ name: 'Tenant', value: 'acme' })).toBe('Tenant=acme');
  });

  it('parses at the first "=" and rejects missing names', () => {
    expect(parsePropertyFilter('Tenant=acme')).toEqual({ name: 'Tenant', value: 'acme' });
    expect(parsePropertyFilter('Url=a=b')).toEqual({ name: 'Url', value: 'a=b' });
    expect(parsePropertyFilter('Empty=')).toEqual({ name: 'Empty', value: '' });
    expect(parsePropertyFilter('=x')).toBeNull();
    expect(parsePropertyFilter('nothing')).toBeNull();
  });
});
