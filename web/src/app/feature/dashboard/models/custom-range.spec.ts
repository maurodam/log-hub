import { buildCustomRange, combineDateTime, toTimeInput } from './custom-range';

describe('custom range helpers', () => {
  const day = new Date(2026, 9, 20);

  it('combines a day and a time in local time', () => {
    expect(combineDateTime(day, '14:05')).toEqual(new Date(2026, 9, 20, 14, 5));
    expect(combineDateTime(day, '07:30:15')).toEqual(new Date(2026, 9, 20, 7, 30, 15));
    expect(combineDateTime(day, '24:00')).toBeNull();
    expect(combineDateTime(day, '')).toBeNull();
  });

  it('formats times for time inputs', () => {
    expect(toTimeInput(new Date(2026, 9, 20, 9, 5))).toBe('09:05');
  });

  it('builds ISO bounds and validates the order', () => {
    expect(buildCustomRange(day, '10:00', new Date(2026, 9, 21), '09:00')).toEqual({
      from: new Date(2026, 9, 20, 10).toISOString(),
      to: new Date(2026, 9, 21, 9).toISOString(),
    });
    expect(buildCustomRange(day, '10:00', undefined, '11:00')).toEqual({
      from: new Date(2026, 9, 20, 10).toISOString(),
      to: new Date(2026, 9, 20, 11).toISOString(),
    });
    expect(buildCustomRange(day, '10:00', day, '10:00')).toEqual({
      error: 'The end must be after the start.',
    });
    expect(buildCustomRange(undefined, '10:00', day, '11:00')).toEqual({
      error: 'Pick a start date.',
    });
    expect(buildCustomRange(day, 'x', day, '11:00')).toEqual({ error: 'Enter valid times.' });
  });
});
