import {
  addRecipients,
  isEmailAddress,
  MAX_RECIPIENTS,
  recipientsError,
  splitRecipients,
} from './recipients';

describe('isEmailAddress', () => {
  it('accepts plain addresses', () => {
    expect(isEmailAddress('ops@example.com')).toBe(true);
    expect(isEmailAddress('first.last+tag@sub.example.co')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isEmailAddress('ops')).toBe(false);
    expect(isEmailAddress('ops@example')).toBe(false);
    expect(isEmailAddress('a b@example.com')).toBe(false);
    expect(isEmailAddress('@example.com')).toBe(false);
  });
});

describe('splitRecipients', () => {
  it('splits on commas, semicolons and whitespace', () => {
    expect(splitRecipients('a@x.io, b@x.io;c@x.io\nd@x.io  e@x.io')).toEqual([
      'a@x.io',
      'b@x.io',
      'c@x.io',
      'd@x.io',
      'e@x.io',
    ]);
  });

  it('keeps only the address of "Name <address>" entries', () => {
    expect(splitRecipients('Jane Doe <jane@x.io>, "Ops" <ops@x.io>')).toEqual([
      'jane@x.io',
      'ops@x.io',
    ]);
  });
});

describe('addRecipients', () => {
  it('adds valid addresses and rejects invalid ones and duplicates', () => {
    const result = addRecipients(['ops@x.io'], 'OPS@x.io, dev@x.io, nope');
    expect(result.recipients).toEqual(['ops@x.io', 'dev@x.io']);
    expect(result.rejected).toEqual(['OPS@x.io', 'nope']);
    expect(result.error).toBe('OPS@x.io is already in the list.');
  });

  it(`stops at ${MAX_RECIPIENTS} recipients`, () => {
    const full = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `user${i}@x.io`);
    const result = addRecipients(full, 'extra@x.io');
    expect(result.recipients).toHaveLength(MAX_RECIPIENTS);
    expect(result.rejected).toEqual(['extra@x.io']);
    expect(result.error).toBe(`At most ${MAX_RECIPIENTS} recipients.`);
  });
});

describe('recipientsError', () => {
  it('requires at least one recipient', () => {
    expect(recipientsError([])).toBe('Add at least one recipient.');
    expect(recipientsError(['ops@x.io'])).toBeNull();
  });

  it('reports overflow, invalid entries and duplicates', () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.io`);
    expect(recipientsError(many)).toBe(`At most ${MAX_RECIPIENTS} recipients.`);
    expect(recipientsError(['bad'])).toBe('"bad" is not a valid email address.');
    expect(recipientsError(['a@x.io', 'A@x.io'])).toBe('A@x.io is listed twice.');
  });
});
