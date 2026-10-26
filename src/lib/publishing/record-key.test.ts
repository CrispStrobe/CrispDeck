import { describe, expect, it, vi } from 'vitest';
import { ensureValidTid } from '@atproto/syntax';
import { newRecordKey } from './record-key';

describe('Bluesky outbox keys', () => {
  it('satisfies the official TID validator and remains unique when the clock does not advance', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const keys = Array.from({ length: 100 }, newRecordKey);
      for (const key of keys) expect(() => ensureValidTid(key)).not.toThrow();
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toEqual([...keys].sort());
    } finally { now.mockRestore(); }
  });
});
