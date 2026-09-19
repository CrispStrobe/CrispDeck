/**
 * Moved out of layout.test.ts, which asserted against local copies of these
 * formatters. They now live in $lib/time-format and are what Post.svelte and
 * the archive page render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDate, relativeTime } from './time-format';

afterEach(() => vi.useRealTimers());

describe('relativeTime formatting', () => {

  it('returns "now" for less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('now');
  });

  it('returns minutes for < 1 hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5m');
  });

  it('returns hours for < 1 day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(relativeTime(threeHoursAgo)).toBe('3h');
  });

  it('returns days for < 1 week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(relativeTime(twoDaysAgo)).toBe('2d');
  });

  it('returns short date for > 1 week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const result = relativeTime(twoWeeksAgo);
    // Should be like "May 25" or "Jun 1"
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('returns empty for missing date', () => {
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('')).toBe('');
  });

  it('returns empty for invalid date', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });
});

describe('formatDate', () => {

  it('formats valid date', () => {
    // toLocaleDateString renders in the local zone, so a UTC literal lands on a
    // different calendar day past ±12 — build local noon of the day we assert.
    const result = formatDate(new Date(2026, 5, 8, 12, 0, 0).toISOString());
    expect(result).toContain('Jun');
    expect(result).toContain('8');
    expect(result).toContain('2026');
  });

  it('returns dash for missing date', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('returns dash for invalid date', () => {
    expect(formatDate('garbage')).toBe('—');
  });
});
