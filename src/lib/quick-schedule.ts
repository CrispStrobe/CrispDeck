/**
 * Turning the compose page's date and time pickers into a stored timestamp.
 *
 * `<input type="date">` and `<input type="time">` give "YYYY-MM-DD" and "HH:mm"
 * with no zone. Concatenated as "YYYY-MM-DDTHH:mm", JavaScript parses that as
 * *local* wall-clock time, which is what the person picking 2pm meant. The
 * stored ISO string is therefore in UTC and can land on a different calendar
 * day — correct, but worth knowing before comparing it to the picked date.
 */

/** ISO timestamp for a picked date and time, or null if either is missing. */
export function buildScheduledAt(date: string, time: string): string | null {
  if (!date || !time) return null;
  const at = new Date(`${date}T${time}`);
  if (isNaN(at.getTime())) return null;
  return at.toISOString();
}

/** Earliest date the picker should allow: today, in the user's own zone. */
export function minScheduleDate(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().split('T')[0];
}

/** Human-readable confirmation for a stored timestamp. */
export function formatScheduledFor(iso: string): string {
  return new Date(iso).toLocaleString();
}
