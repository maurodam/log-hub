const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Smallest "nice" number (1, 2 or 5 times a power of ten) that is >= `rough`. */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  // Rounding avoids results like 0.30000000000000004 for fractional steps.
  return Number((nice * power).toPrecision(12));
}

export interface LinearTicks {
  /** Top of the axis (a multiple of `step`, >= the data maximum). */
  max: number;
  step: number;
  /** From 0 to `max`, both included. */
  ticks: number[];
}

/**
 * Y axis for counts: integer steps, at most about `maxTicks` intervals, starting at 0.
 * An empty or all-zero series still gets a 0..1 axis.
 */
export function linearTicks(maxValue: number, maxTicks = 4): LinearTicks {
  const intervals = Math.max(1, Math.floor(maxTicks));
  if (!(maxValue > 0)) return { max: 1, step: 1, ticks: [0, 1] };
  const step = Math.max(1, niceStep(maxValue / intervals));
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);
  return { max, step, ticks };
}

/** Candidate spacings for time axis labels. */
export const TIME_STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
] as const;

/** Smallest step from `TIME_STEPS` that keeps the label count within `maxTicks`. */
export function timeTickStep(spanMs: number, maxTicks: number): number {
  const limit = Math.max(1, Math.floor(maxTicks));
  return TIME_STEPS.find((step) => spanMs / step <= limit) ?? TIME_STEPS[TIME_STEPS.length - 1];
}

function localMidnight(ms: number): Date {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Tick positions between `fromMs` and `toMs` (inclusive), aligned to round local times:
 * multiples of the step since local midnight, or local midnights for day steps.
 */
export function timeTicks(fromMs: number, toMs: number, maxTicks: number): number[] {
  if (!(toMs > fromMs)) return [];
  const step = timeTickStep(toMs - fromMs, maxTicks);
  const ticks: number[] = [];
  if (step < DAY) {
    const midnight = localMidnight(fromMs).getTime();
    for (let t = midnight + Math.ceil((fromMs - midnight) / step) * step; t <= toMs; t += step) {
      ticks.push(t);
    }
    return ticks;
  }
  const days = Math.round(step / DAY);
  const day = localMidnight(fromMs);
  if (day.getTime() < fromMs) day.setDate(day.getDate() + 1);
  // setDate keeps local midnight across daylight saving changes.
  for (; day.getTime() <= toMs; day.setDate(day.getDate() + days)) ticks.push(day.getTime());
  return ticks;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value: number) => String(value).padStart(2, '0');

function formatDay(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

function formatClock(date: Date, seconds = false): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return seconds ? `${time}:${pad(date.getSeconds())}` : time;
}

/** Axis label: `HH:mm` within a day (the date at local midnight), `MMM d` for day steps. */
export function formatTimeTick(ms: number, stepMs: number): string {
  const date = new Date(ms);
  const atMidnight = date.getHours() === 0 && date.getMinutes() === 0;
  return stepMs >= DAY || atMidnight ? formatDay(date) : formatClock(date);
}

/** Tooltip title of a bucket, e.g. `Oct 20 14:00 – 14:30` or `Oct 20 22:00 – Oct 21 00:00`. */
export function formatBucketRange(startMs: number, endMs: number): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const seconds = endMs - startMs < MINUTE || start.getSeconds() !== 0 || end.getSeconds() !== 0;
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const head = `${formatDay(start)} ${formatClock(start, seconds)}`;
  const tail = sameDay
    ? formatClock(end, seconds)
    : `${formatDay(end)} ${formatClock(end, seconds)}`;
  return `${head} – ${tail}`;
}

/** Bucket size for labels: `30 s`, `5 min`, `90 min`, `6 h`, `1 d`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 86_400 && s % 86_400 === 0) return `${s / 86_400} d`;
  if (s >= 3_600 && s % 3_600 === 0) return `${s / 3_600} h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

const compactFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Short count for axis labels: 950, 1.2K, 3M. */
export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

/** Index of the bar under `x` (plot coordinates), or null outside the plot. */
export function bucketAt(x: number, plotWidth: number, count: number): number | null {
  if (count <= 0 || plotWidth <= 0 || x < 0 || x > plotWidth) return null;
  return Math.min(count - 1, Math.floor((x / plotWidth) * count));
}
