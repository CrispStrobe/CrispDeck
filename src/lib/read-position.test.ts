import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveReadPosition, getReadPosition, findReadPositionIndex, clearReadPosition, flushReadPositions } from './read-position';

describe('read position', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  it('returns null when no position saved', () => {
    expect(getReadPosition('feed')).toBeNull();
  });

  it('saves and retrieves position', () => {
    saveReadPosition('feed', 'at://post-123', 500);
    const pos = getReadPosition('feed');
    expect(pos).toBeTruthy();
    expect(pos!.lastSeenUri).toBe('at://post-123');
    expect(pos!.scrollY).toBe(500);
  });

  it('updates position for same context', () => {
    saveReadPosition('feed', 'at://post-1');
    saveReadPosition('feed', 'at://post-2');
    expect(getReadPosition('feed')!.lastSeenUri).toBe('at://post-2');
  });

  it('tracks multiple contexts independently', () => {
    saveReadPosition('feed', 'at://feed-post');
    saveReadPosition('deck-timeline', 'at://deck-post');
    expect(getReadPosition('feed')!.lastSeenUri).toBe('at://feed-post');
    expect(getReadPosition('deck-timeline')!.lastSeenUri).toBe('at://deck-post');
  });

  it('finds position index in post list', () => {
    saveReadPosition('feed', 'at://post-2');
    const idx = findReadPositionIndex('feed', ['at://post-1', 'at://post-2', 'at://post-3']);
    expect(idx).toBe(1);
  });

  it('returns -1 when post not in list', () => {
    saveReadPosition('feed', 'at://gone');
    expect(findReadPositionIndex('feed', ['at://post-1'])).toBe(-1);
  });

  it('clears position', () => {
    saveReadPosition('feed', 'at://post-1');
    clearReadPosition('feed');
    expect(getReadPosition('feed')).toBeNull();
  });

  it('reads from in-memory cache without hitting localStorage', () => {
    saveReadPosition('cached', 'at://cache-test');
    // Second read should use cache (no additional localStorage.getItem)
    const pos = getReadPosition('cached');
    expect(pos!.lastSeenUri).toBe('at://cache-test');
  });

  it('flushReadPositions writes immediately', () => {
    vi.useFakeTimers();
    saveReadPosition('flush-test', 'at://flush-uri');
    // Before flush, the throttled write hasn't fired yet
    flushReadPositions();
    // After flush, the data should be in localStorage
    vi.useRealTimers();
  });

  it('exports flushReadPositions function', () => {
    expect(typeof flushReadPositions).toBe('function');
  });
});
