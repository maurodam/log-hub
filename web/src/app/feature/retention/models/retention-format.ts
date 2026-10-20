export interface RetentionPreset {
  label: string;
  days: number;
}

export const RETENTION_PRESETS: readonly RetentionPreset[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
  { label: '2 years', days: 730 },
];

const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);

function unit(value: string, name: string): string {
  return `${value} ${name}${value === '1' ? '' : 's'}`;
}

/** Approximate period in larger units, or null when "N days" says it all. */
function approximation(days: number): string | null {
  if (days >= 365) {
    return days % 365 === 0
      ? unit(String(days / 365), 'year')
      : `~${unit(oneDecimal(days / 365), 'year')}`;
  }
  if (days >= 28) return `~${unit(oneDecimal(days / 30), 'month')}`;
  if (days >= 7 && days % 7 === 0) return unit(String(days / 7), 'week');
  return null;
}

/**
 * Human text for a retention period: "1 day", "7 days (1 week)", "90 days (~3 months)",
 * "365 days (1 year)", "400 days (~1.1 years)".
 */
export function formatRetentionDays(days: number): string {
  const text = unit(String(days), 'day');
  const approx = approximation(days);
  return approx ? `${text} (${approx})` : text;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Binary size: "0 B", "512 B", "1.5 KB", "12 MB", "3.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024;
    index++;
  }
  const digits = index === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[index]}`;
}

/** Whole-number count with thousands separators. */
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : value.toLocaleString('en-US');
}

/** True when `value` is a whole number of days the server accepts (at least 1). */
export function isValidRetentionDays(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 1;
}
