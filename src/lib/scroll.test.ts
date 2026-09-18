// @vitest-environment jsdom
/**
 * These run in jsdom, which has no layout engine — getComputedStyle returns
 * whatever was set inline, which is enough to exercise the search.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findScrollParent, scrollTopOf, isAtScrollTop } from './scroll';

function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector('[data-target]') as HTMLElement;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => vi.unstubAllGlobals());

describe('findScrollParent', () => {
  it('finds an ancestor with overflow-y: auto', () => {
    const el = build(`<main style="overflow-y:auto" id="m"><div><span data-target></span></div></main>`);
    expect(findScrollParent(el)?.id).toBe('m');
  });

  it('finds an ancestor with overflow-y: scroll', () => {
    const el = build(`<div style="overflow-y:scroll" id="s"><span data-target></span></div>`);
    expect(findScrollParent(el)?.id).toBe('s');
  });

  it('returns the nearest one when scrollers are nested', () => {
    const el = build(
      `<div style="overflow-y:auto" id="outer"><div style="overflow-y:auto" id="inner"><span data-target></span></div></div>`
    );
    expect(findScrollParent(el)?.id).toBe('inner');
  });

  it('returns null when nothing scrolls', () => {
    const el = build(`<div><span data-target></span></div>`);
    expect(findScrollParent(el)).toBeNull();
  });

  it('ignores overflow-y: hidden and visible', () => {
    const el = build(`<div style="overflow-y:hidden"><div style="overflow-y:visible"><span data-target></span></div></div>`);
    expect(findScrollParent(el)).toBeNull();
  });

  it('does not walk past body', () => {
    document.body.style.overflowY = 'auto';
    const el = build(`<div><span data-target></span></div>`);
    expect(findScrollParent(el)).toBeNull();
    document.body.style.overflowY = '';
  });

  it('handles a null element', () => {
    expect(findScrollParent(null)).toBeNull();
  });

  it('does not treat the element itself as its own scroller', () => {
    const el = build(`<span data-target style="overflow-y:auto"></span>`);
    expect(findScrollParent(el)).toBeNull();
  });
});

describe('scrollTopOf', () => {
  it('reads the scroll parent, not the window', () => {
    const el = build(`<main style="overflow-y:auto" id="m"><span data-target></span></main>`);
    const main = document.getElementById('m') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 742, configurable: true });
    vi.stubGlobal('scrollY', 0); // the shell never scrolls the window
    expect(scrollTopOf(el)).toBe(742);
  });

  it('falls back to the window when nothing else scrolls', () => {
    const el = build(`<div><span data-target></span></div>`);
    vi.stubGlobal('scrollY', 55);
    expect(scrollTopOf(el)).toBe(55);
  });
});

describe('isAtScrollTop', () => {
  it('is true only when the scroll parent is at the top', () => {
    const el = build(`<main style="overflow-y:auto" id="m"><span data-target></span></main>`);
    const main = document.getElementById('m') as HTMLElement;

    Object.defineProperty(main, 'scrollTop', { value: 0, configurable: true });
    expect(isAtScrollTop(el)).toBe(true);

    Object.defineProperty(main, 'scrollTop', { value: 900, configurable: true });
    expect(isAtScrollTop(el)).toBe(false);
  });

  /** The bug this exists to prevent. */
  it('is false deep in an inner scroller even though window.scrollY is 0', () => {
    const el = build(`<main style="overflow-y:auto" id="m"><span data-target></span></main>`);
    const main = document.getElementById('m') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 5000, configurable: true });
    vi.stubGlobal('scrollY', 0);
    expect(window.scrollY).toBe(0);
    expect(isAtScrollTop(el)).toBe(false);
  });

  it('tolerates sub-pixel offsets', () => {
    const el = build(`<main style="overflow-y:auto" id="m"><span data-target></span></main>`);
    const main = document.getElementById('m') as HTMLElement;
    Object.defineProperty(main, 'scrollTop', { value: 0.5, configurable: true });
    expect(isAtScrollTop(el)).toBe(true);
  });
});
