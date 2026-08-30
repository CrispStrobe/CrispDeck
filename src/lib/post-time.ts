/**
 * Timestamp helpers for feed freshness checks.
 *
 * Post timestamps arrive in several shapes depending on the source: ISO strings
 * from the AT Protocol and Mastodon's REST API, `Date` objects from masto.js,
 * and epoch numbers from a few normalizers. Comparing those with `>` silently
 * does the wrong thing (string vs. Date, `+00:00` vs. `Z`, differing fractional
 * precision), which is how "N new posts" ends up permanently stuck at 0.
 */

/** Parse any supported post timestamp to epoch milliseconds. Returns 0 when unparseable. */
export function toTime(value: unknown): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** True when `value` is a parseable timestamp strictly newer than `referenceMs`. */
export function isNewerThan(value: unknown, referenceMs: number): boolean {
  const t = toTime(value);
  return t > 0 && t > referenceMs;
}
