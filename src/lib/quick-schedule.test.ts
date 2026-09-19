/**
 * Scheduling a post from compose.
 *
 * This previously rebuilt `new Date(`${date}T${time}`).toISOString()` in the
 * test body and asserted the result, so it passed whatever compose did. It now
 * exercises $lib/quick-schedule, which compose calls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildScheduledAt, minScheduleDate, formatScheduledFor } from './quick-schedule';

afterEach(() => vi.useRealTimers());

/**
 * A date+time pair is local wall-clock time, so the stored ISO string can sit
 * on a different UTC calendar day than the one picked. Asserting on its text
 * only holds near UTC; round-trip through the local getters instead.
 */
function expectLocalWallClock(iso: string, date: string, time: string) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const back = new Date(iso);
  expect(back.getFullYear()).toBe(y);
  expect(back.getMonth()).toBe(mo - 1);
  expect(back.getDate()).toBe(d);
  expect(back.getHours()).toBe(h);
  expect(back.getMinutes()).toBe(mi);
}

describe('buildScheduledAt', () => {
  it('builds an ISO timestamp from the two pickers', () => {
    const iso = buildScheduledAt('2026-07-10', '14:30')!;
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    expectLocalWallClock(iso, '2026-07-10', '14:30');
  });

  it('preserves the picked wall-clock time across the year', () => {
    // Both sides of a daylight-saving change, where a naive offset would drift.
    for (const date of ['2026-01-15', '2026-07-15']) {
      expectLocalWallClock(buildScheduledAt(date, '09:05')!, date, '09:05');
    }
  });

  it('handles midnight and the last minute of the day', () => {
    expectLocalWallClock(buildScheduledAt('2026-07-10', '00:00')!, '2026-07-10', '00:00');
    expectLocalWallClock(buildScheduledAt('2026-07-10', '23:59')!, '2026-07-10', '23:59');
  });

  it('is null when either picker is empty, so nothing is scheduled', () => {
    expect(buildScheduledAt('', '14:30')).toBeNull();
    expect(buildScheduledAt('2026-07-10', '')).toBeNull();
    expect(buildScheduledAt('', '')).toBeNull();
  });

  it('is null rather than "Invalid Date" for nonsense input', () => {
    expect(buildScheduledAt('not-a-date', '14:30')).toBeNull();
    expect(buildScheduledAt('2026-07-10', 'half past two')).toBeNull();
  });

  it('round-trips through Date without losing the minute', () => {
    const iso = buildScheduledAt('2026-02-28', '17:45')!;
    expect(new Date(iso).getMinutes()).toBe(45);
  });
});

describe('minScheduleDate', () => {
  it('is today in the user’s own zone, not UTC', () => {
    // 22:30 local on the 10th is already the 11th in UTC for +02:00, and the
    // picker must still allow the 10th.
    const now = new Date('2026-07-10T20:30:00.000Z');
    const expected = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString().split('T')[0];
    expect(minScheduleDate(now)).toBe(expected);
  });

  it('is a plain YYYY-MM-DD, which is what the input wants', () => {
    expect(minScheduleDate(new Date('2026-07-10T12:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults to now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    expect(minScheduleDate()).toMatch(/^2026-05-\d{2}$/);
  });

  it('allows scheduling for today', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const today = minScheduleDate(now);
    const scheduled = buildScheduledAt(today, '23:59');
    expect(scheduled).not.toBeNull();
  });
});

describe('formatScheduledFor', () => {
  it('renders the stored timestamp for the confirmation toast', () => {
    const iso = buildScheduledAt('2026-07-10', '14:30')!;
    expect(formatScheduledFor(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('shows the local wall-clock time the user picked', () => {
    const iso = buildScheduledAt('2026-07-10', '14:30')!;
    expect(formatScheduledFor(iso)).toContain(String(new Date(iso).getHours() % 12 || 12));
  });
});
