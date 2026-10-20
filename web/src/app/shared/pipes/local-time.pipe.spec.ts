import { formatLocalTime } from './local-time.pipe';

describe('formatLocalTime', () => {
  // Built from local-time parts so the test passes in any time zone.
  const now = new Date(2026, 9, 20, 15, 30, 0, 0);

  it('shows only the time for events from today', () => {
    const iso = new Date(2026, 9, 20, 9, 5, 7, 42).toISOString();
    expect(formatLocalTime(iso, now)).toBe('09:05:07.042');
  });

  it('adds the date for events from another day', () => {
    const iso = new Date(2026, 9, 19, 23, 59, 59, 999).toISOString();
    expect(formatLocalTime(iso, now)).toBe('2026-10-19 23:59:59.999');
  });

  it('returns invalid input unchanged', () => {
    expect(formatLocalTime('not a date', now)).toBe('not a date');
  });
});
