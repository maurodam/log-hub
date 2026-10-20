import { formatDateTime, formatTimeAgo } from './time-ago';

describe('formatTimeAgo', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('returns an empty string for missing or invalid input', () => {
    expect(formatTimeAgo(null, now)).toBe('');
    expect(formatTimeAgo('not a date', now)).toBe('');
  });

  it('formats past times', () => {
    expect(formatTimeAgo(ago(10_000), now)).toBe('just now');
    expect(formatTimeAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(formatTimeAgo(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(formatTimeAgo(ago(86_400_000), now)).toBe('1 day ago');
    expect(formatTimeAgo(ago(45 * 86_400_000), now)).toBe('1 month ago');
    expect(formatTimeAgo(ago(800 * 86_400_000), now)).toBe('2 years ago');
  });

  it('formats future times', () => {
    expect(formatTimeAgo(ago(-10 * 60_000), now)).toBe('in 10 min');
  });
});

describe('formatDateTime', () => {
  it('formats local date and time', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatDateTime(date.toISOString())).toBe('2026-01-02 03:04:05');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatDateTime('nope')).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });
});
