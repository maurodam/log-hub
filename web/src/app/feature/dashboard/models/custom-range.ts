const pad = (value: number) => String(value).padStart(2, '0');

/** `HH:mm` for an `<input type="time">`, in local time. */
export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local date (day of `day`) at `time` (`HH:mm` or `HH:mm:ss`); null when `time` is invalid. */
export function combineDateTime(day: Date, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, seconds);
}

export type CustomRangeResult = { from: string; to: string } | { error: string };

/** Validates the picker draft and returns ISO bounds for the URL. */
export function buildCustomRange(
  startDay: Date | undefined,
  startTime: string,
  endDay: Date | undefined,
  endTime: string,
): CustomRangeResult {
  if (!startDay) return { error: 'Pick a start date.' };
  const from = combineDateTime(startDay, startTime);
  const to = combineDateTime(endDay ?? startDay, endTime);
  if (!from || !to) return { error: 'Enter valid times.' };
  if (from >= to) return { error: 'The end must be after the start.' };
  return { from: from.toISOString(), to: to.toISOString() };
}
