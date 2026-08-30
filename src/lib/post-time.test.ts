import { describe, it, expect } from 'vitest';
import { toTime, isNewerThan } from './post-time';

describe('toTime', () => {
  it('parses ISO strings', () => {
    expect(toTime('2026-08-30T12:00:00.000Z')).toBe(Date.parse('2026-08-30T12:00:00.000Z'));
  });

  it('treats a zone offset and Z as the same instant', () => {
    expect(toTime('2026-08-30T14:00:00+02:00')).toBe(toTime('2026-08-30T12:00:00Z'));
  });

  it('accepts Date objects (masto.js returns these)', () => {
    const d = new Date('2026-08-30T12:00:00Z');
    expect(toTime(d)).toBe(d.getTime());
  });

  it('accepts epoch numbers', () => {
    expect(toTime(1756555200000)).toBe(1756555200000);
  });

  it('returns 0 for unparseable input', () => {
    expect(toTime(undefined)).toBe(0);
    expect(toTime(null)).toBe(0);
    expect(toTime('')).toBe(0);
    expect(toTime('not a date')).toBe(0);
    expect(toTime(new Date('nope'))).toBe(0);
    expect(toTime(NaN)).toBe(0);
  });
});

describe('isNewerThan', () => {
  const ref = Date.parse('2026-08-30T12:00:00Z');

  it('is true for a strictly later timestamp', () => {
    expect(isNewerThan('2026-08-30T12:00:01Z', ref)).toBe(true);
  });

  it('is false for the same instant', () => {
    expect(isNewerThan('2026-08-30T12:00:00.000Z', ref)).toBe(false);
  });

  it('is false for an earlier timestamp', () => {
    expect(isNewerThan('2026-08-30T11:59:59Z', ref)).toBe(false);
  });

  it('compares across mixed shapes rather than lexically', () => {
    // "2026-08-30T14:00:00+02:00" sorts after the reference as a string but is
    // the same instant — string comparison would wrongly report a new post.
    expect(isNewerThan('2026-08-30T14:00:00+02:00', ref)).toBe(false);
    expect(isNewerThan(new Date(ref + 1000), ref)).toBe(true);
  });

  it('is false for unparseable input', () => {
    expect(isNewerThan(undefined, ref)).toBe(false);
    expect(isNewerThan('garbage', ref)).toBe(false);
  });
});
