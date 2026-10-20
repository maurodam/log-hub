import {
  formatBytes,
  formatCount,
  formatRetentionDays,
  isValidRetentionDays,
} from './retention-format';

describe('formatRetentionDays', () => {
  it('uses plain days for short periods', () => {
    expect(formatRetentionDays(1)).toBe('1 day');
    expect(formatRetentionDays(3)).toBe('3 days');
    expect(formatRetentionDays(10)).toBe('10 days');
  });

  it('adds weeks for whole weeks under four weeks', () => {
    expect(formatRetentionDays(7)).toBe('7 days (1 week)');
    expect(formatRetentionDays(14)).toBe('14 days (2 weeks)');
  });

  it('approximates months', () => {
    expect(formatRetentionDays(30)).toBe('30 days (~1 month)');
    expect(formatRetentionDays(90)).toBe('90 days (~3 months)');
    expect(formatRetentionDays(180)).toBe('180 days (~6 months)');
    expect(formatRetentionDays(45)).toBe('45 days (~1.5 months)');
  });

  it('uses exact years for multiples of 365 and approximates otherwise', () => {
    expect(formatRetentionDays(365)).toBe('365 days (1 year)');
    expect(formatRetentionDays(730)).toBe('730 days (2 years)');
    expect(formatRetentionDays(400)).toBe('400 days (~1.1 years)');
  });
});

describe('formatBytes', () => {
  it('formats binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB');
  });

  it('treats invalid sizes as zero', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(null)).toBe('');
  });
});

describe('isValidRetentionDays', () => {
  it('accepts whole days from 1', () => {
    expect(isValidRetentionDays(1)).toBe(true);
    expect(isValidRetentionDays(0)).toBe(false);
    expect(isValidRetentionDays(1.5)).toBe(false);
    expect(isValidRetentionDays(null)).toBe(false);
  });
});
