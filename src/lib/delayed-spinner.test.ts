/**
 * DelayedSpinner, mounted.
 *
 * This file used to call setTimeout in the test body and assert that a local
 * `show` flag flipped — a test of JavaScript's timers, which passed whatever
 * the component did. With `resolve.conditions: ['browser']` in vite.config.js,
 * `svelte` resolves to its client build and mount() is available, so the
 * component itself can be rendered and its behaviour checked.
 *
 * The point of the component is to avoid flicker: a spinner that appears for
 * 40ms is worse than no spinner, so nothing renders until the work has been
 * slow enough to be worth reporting.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import DelayedSpinner from '$lib/components/DelayedSpinner.svelte';

function render(props: { delay?: number } = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const children = createRawSnippet(() => ({ render: () => '<span>loading…</span>' }));
  const app = mount(DelayedSpinner, { target, props: { ...props, children } as any });
  flushSync();
  return {
    target,
    text: () => target.textContent ?? '',
    destroy: () => { unmount(app); target.remove(); },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('DelayedSpinner', () => {
  it('renders nothing immediately', () => {
    const view = render({ delay: 100 });
    expect(view.text()).toBe('');
    view.destroy();
  });

  it('renders its children once the delay has passed', () => {
    const view = render({ delay: 100 });
    vi.advanceTimersByTime(100);
    flushSync();
    expect(view.text()).toContain('loading…');
    view.destroy();
  });

  it('stays hidden just before the delay', () => {
    const view = render({ delay: 100 });
    vi.advanceTimersByTime(99);
    flushSync();
    expect(view.text()).toBe('');
    view.destroy();
  });

  it('honours a custom delay', () => {
    const view = render({ delay: 500 });
    vi.advanceTimersByTime(200);
    flushSync();
    expect(view.text()).toBe('');
    vi.advanceTimersByTime(300);
    flushSync();
    expect(view.text()).toContain('loading…');
    view.destroy();
  });

  it('uses its default delay when none is given', () => {
    const view = render();
    vi.advanceTimersByTime(99);
    flushSync();
    expect(view.text()).toBe('');
    vi.advanceTimersByTime(1);
    flushSync();
    expect(view.text()).toContain('loading…');
    view.destroy();
  });

  /** The whole point: work that finishes quickly must never flash a spinner. */
  it('never renders when unmounted before the delay elapses', () => {
    const view = render({ delay: 100 });
    vi.advanceTimersByTime(50);
    view.destroy();
    vi.advanceTimersByTime(100);
    flushSync();
    expect(document.body.textContent).toBe('');
  });

  it('clears its timer on unmount, so nothing fires later', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const view = render({ delay: 100 });
    view.destroy();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('stays rendered once shown', () => {
    const view = render({ delay: 10 });
    vi.advanceTimersByTime(10);
    flushSync();
    expect(view.text()).toContain('loading…');
    vi.advanceTimersByTime(10_000);
    flushSync();
    expect(view.text()).toContain('loading…');
    view.destroy();
  });

  it('a zero delay still defers past the first paint', () => {
    const view = render({ delay: 0 });
    expect(view.text()).toBe('');
    vi.advanceTimersByTime(0);
    flushSync();
    expect(view.text()).toContain('loading…');
    view.destroy();
  });

  it('two spinners keep their own timers', () => {
    const fast = render({ delay: 50 });
    const slow = render({ delay: 500 });
    vi.advanceTimersByTime(50);
    flushSync();
    expect(fast.text()).toContain('loading…');
    expect(slow.text()).toBe('');
    fast.destroy();
    slow.destroy();
  });
});
