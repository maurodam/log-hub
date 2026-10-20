import {
  bucketAt,
  DAY,
  formatBucketRange,
  formatCompact,
  formatDuration,
  formatTimeTick,
  linearTicks,
  niceStep,
  timeTicks,
  timeTickStep,
} from './chart-scale';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Local time, so the tests do not depend on the machine's time zone. */
const local = (day: number, hours = 0, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).getTime();

describe('niceStep', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.2)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(240)).toBe(500);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(0)).toBe(1);
  });
});

describe('linearTicks', () => {
  it('covers the maximum with integer steps from zero', () => {
    expect(linearTicks(1234, 4)).toEqual({ max: 1500, step: 500, ticks: [0, 500, 1000, 1500] });
    expect(linearTicks(100, 4)).toEqual({ max: 100, step: 50, ticks: [0, 50, 100] });
  });

  it('never uses fractional steps for small counts', () => {
    expect(linearTicks(3, 4)).toEqual({ max: 3, step: 1, ticks: [0, 1, 2, 3] });
    expect(linearTicks(1, 4).step).toBe(1);
  });

  it('gives an all-zero series a 0..1 axis', () => {
    expect(linearTicks(0)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
    expect(linearTicks(Number.NaN)).toEqual({ max: 1, step: 1, ticks: [0, 1] });
  });

  it('keeps the number of intervals within the limit', () => {
    for (const max of [7, 19, 99, 101, 4_321, 98_765]) {
      const axis = linearTicks(max, 5);
      expect(axis.max).toBeGreaterThanOrEqual(max);
      expect(axis.ticks.length - 1).toBeLessThanOrEqual(5);
    }
  });
});

describe('time ticks', () => {
  it('picks the smallest step that fits', () => {
    expect(timeTickStep(HOUR, 6)).toBe(10 * MINUTE);
    expect(timeTickStep(HOUR, 4)).toBe(15 * MINUTE);
    expect(timeTickStep(24 * HOUR, 8)).toBe(3 * HOUR);
    expect(timeTickStep(7 * DAY, 8)).toBe(DAY);
    expect(timeTickStep(30 * DAY, 8)).toBe(7 * DAY);
    expect(timeTickStep(365 * DAY, 4)).toBe(14 * DAY);
  });

  it('aligns ticks to round local times inside the window', () => {
    const from = local(20, 10, 7);
    const to = local(20, 11, 7);
    const ticks = timeTicks(from, to, 4);
    expect(ticks).toEqual([
      local(20, 10, 15),
      local(20, 10, 30),
      local(20, 10, 45),
      local(20, 11, 0),
    ]);
  });

  it('uses local midnights for day steps', () => {
    const ticks = timeTicks(local(13, 12), local(20, 12), 8);
    expect(ticks).toHaveLength(7);
    for (const tick of ticks) {
      const date = new Date(tick);
      expect([date.getHours(), date.getMinutes()]).toEqual([0, 0]);
    }
    expect(new Date(ticks[0]).getDate()).toBe(14);
  });

  it('returns nothing for an empty window', () => {
    expect(timeTicks(local(20), local(20), 5)).toEqual([]);
  });

  it('formats labels by step', () => {
    expect(formatTimeTick(local(20, 9, 5), 15 * MINUTE)).toBe('09:05');
    expect(formatTimeTick(local(20), 3 * HOUR)).toBe('Oct 20');
    expect(formatTimeTick(local(21), DAY)).toBe('Oct 21');
  });
});

describe('formatting helpers', () => {
  it('formats bucket ranges', () => {
    expect(formatBucketRange(local(20, 14), local(20, 14, 30))).toBe('Oct 20 14:00 – 14:30');
    expect(formatBucketRange(local(20, 22), local(21))).toBe('Oct 20 22:00 – Oct 21 00:00');
  });

  it('formats bucket sizes', () => {
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(300)).toBe('5 min');
    expect(formatDuration(5400)).toBe('90 min');
    expect(formatDuration(21_600)).toBe('6 h');
    expect(formatDuration(86_400)).toBe('1 d');
  });

  it('formats compact counts', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1500)).toBe('1.5K');
  });
});

describe('bucketAt', () => {
  it('maps a plot x coordinate to a bar index', () => {
    expect(bucketAt(0, 600, 60)).toBe(0);
    expect(bucketAt(15, 600, 60)).toBe(1);
    expect(bucketAt(600, 600, 60)).toBe(59);
    expect(bucketAt(-1, 600, 60)).toBeNull();
    expect(bucketAt(601, 600, 60)).toBeNull();
    expect(bucketAt(10, 600, 0)).toBeNull();
  });
});
