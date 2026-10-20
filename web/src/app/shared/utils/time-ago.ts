const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const pad = (value: number) => String(value).padStart(2, '0');

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function span(ms: number): string {
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  const days = Math.floor(ms / DAY);
  if (days < 30) return plural(days, 'day');
  if (days < 365) return plural(Math.floor(days / 30), 'month');
  return plural(Math.floor(days / 365), 'year');
}

/**
 * Short English relative time: "just now", "5 min ago", "3 h ago", "2 days ago", "in 10 min".
 * Returns an empty string for missing or invalid input.
 */
export function formatTimeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const diff = now.getTime() - time;
  if (Math.abs(diff) < MINUTE) return 'just now';
  return diff > 0 ? `${span(diff)} ago` : `in ${span(-diff)}`;
}

/** Local date and time as `yyyy-MM-dd HH:mm:ss`. Returns an empty string for invalid input. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
