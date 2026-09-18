import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollWhenVisible } from './poll';

/** Minimal stand-in for document's visibility surface. */
function fakeDoc() {
  const listeners = new Set<() => void>();
  return {
    hidden: false,
    addEventListener: (_t: string, fn: any) => listeners.add(fn),
    removeEventListener: (_t: string, fn: any) => listeners.delete(fn),
    setHidden(hidden: boolean) {
      (this as any).hidden = hidden;
      for (const fn of listeners) fn();
    },
    get listenerCount() { return listeners.size; },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pollWhenVisible', () => {
  it('polls on the interval while visible', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops polling while the tab is hidden', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);

    doc.setHidden(true);
    vi.advanceTimersByTime(60_000); // a minute in the background
    expect(fn).toHaveBeenCalledTimes(2); // nothing fired
    stop();
  });

  it('catches up once on return when an interval was missed', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    doc.setHidden(true);
    vi.advanceTimersByTime(30_000);
    doc.setHidden(false);

    expect(fn).toHaveBeenCalledTimes(1); // one catch-up, not thirty
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2); // and the interval resumed
    stop();
  });

  it('does not catch up when the tab was hidden only briefly', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 10_000, { doc: doc as any, now: () => Date.now() });

    doc.setHidden(true);
    vi.advanceTimersByTime(500);
    doc.setHidden(false);

    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('honours catchUp: false', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now(), catchUp: false });

    doc.setHidden(true);
    vi.advanceTimersByTime(30_000);
    doc.setHidden(false);

    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('does not start while the tab is already hidden', () => {
    const doc = fakeDoc();
    doc.hidden = true;
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('teardown removes the listener and stops the timer', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    expect(doc.listenerCount).toBe(1);
    stop();
    expect(doc.listenerCount).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('stays stopped if visibility changes after teardown', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });
    stop();

    doc.setHidden(true);
    doc.setHidden(false);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('falls back to a plain interval with no document', () => {
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: undefined, now: () => Date.now() });
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not stack timers when visibility flaps', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhenVisible(fn, 1000, { doc: doc as any, now: () => Date.now() });

    for (let i = 0; i < 5; i++) { doc.setHidden(true); doc.setHidden(false); }
    fn.mockClear();

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1); // one timer, not six
    stop();
  });
});
