import { describe, it, expect } from 'vitest';
import { computeWindow, HeightCache, type WindowOptions } from './virtual-list';

const uniform = (h: number) => () => h;

function win(o: Partial<WindowOptions> & Pick<WindowOptions, 'count'>) {
  return computeWindow({
    heightAt: uniform(100),
    viewportTop: 0,
    viewportHeight: 800,
    overscanPx: 0,
    ...o,
  });
}

/** Every item whose box intersects the viewport must be rendered. */
function intersecting(count: number, heightAt: (i: number) => number, top: number, height: number) {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const h = heightAt(i);
    if (offset + h > top && offset < top + height) out.push(i);
    offset += h;
  }
  return out;
}

describe('computeWindow', () => {
  it('renders nothing for an empty list', () => {
    expect(win({ count: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 });
  });

  it('renders the first screenful at the top', () => {
    const w = win({ count: 100 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(8);          // 800px viewport / 100px items
    expect(w.padTop).toBe(0);
    expect(w.total).toBe(10000);
    expect(w.padBottom).toBe(10000 - 800);
  });

  it('moves the window as the viewport scrolls', () => {
    const w = win({ count: 100, viewportTop: 5000 });
    expect(w.start).toBe(50);
    expect(w.end).toBe(58);
    expect(w.padTop).toBe(5000);
  });

  it('padTop + rendered + padBottom always equals total', () => {
    const heights = (i: number) => 40 + ((i * 37) % 260); // jagged, like real posts
    for (let top = 0; top < 20000; top += 137) {
      const w = computeWindow({ count: 300, heightAt: heights, viewportTop: top, viewportHeight: 700, overscanPx: 300 });
      let rendered = 0;
      for (let i = w.start; i < w.end; i++) rendered += heights(i);
      expect(w.padTop + rendered + w.padBottom, `top=${top}`).toBe(w.total);
      expect(w.padTop).toBeGreaterThanOrEqual(0);
      expect(w.padBottom).toBeGreaterThanOrEqual(0);
    }
  });

  it('never omits an item that is actually visible', () => {
    const heights = (i: number) => 40 + ((i * 37) % 260);
    for (let top = 0; top < 20000; top += 91) {
      const w = computeWindow({ count: 300, heightAt: heights, viewportTop: top, viewportHeight: 700, overscanPx: 0 });
      for (const i of intersecting(300, heights, top, 700)) {
        expect(i, `top=${top} missing item ${i}`).toBeGreaterThanOrEqual(w.start);
        expect(i, `top=${top} missing item ${i}`).toBeLessThan(w.end);
      }
    }
  });

  it('overscan widens the window without breaking the invariant', () => {
    const tight = win({ count: 200, viewportTop: 5000, overscanPx: 0 });
    const loose = win({ count: 200, viewportTop: 5000, overscanPx: 500 });
    expect(loose.start).toBeLessThan(tight.start);
    expect(loose.end).toBeGreaterThan(tight.end);
    expect(loose.padTop + (loose.end - loose.start) * 100 + loose.padBottom).toBe(loose.total);
  });

  it('clamps at the end of the list', () => {
    const w = win({ count: 10, viewportTop: 900, viewportHeight: 800 });
    expect(w.end).toBe(10);
    expect(w.padBottom).toBe(0);
  });

  it('keeps one item mounted when scrolled past the end', () => {
    const w = win({ count: 10, viewportTop: 99999, viewportHeight: 800 });
    expect(w.start).toBe(9);
    expect(w.end).toBe(10);
    expect(w.padTop + 100 + w.padBottom).toBe(w.total);
  });

  it('handles a viewport taller than the list', () => {
    const w = win({ count: 3, viewportHeight: 5000 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(3);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe(0);
  });

  it('renders at least one item for a zero-height viewport', () => {
    const w = win({ count: 50, viewportTop: 1000, viewportHeight: 0 });
    expect(w.end).toBeGreaterThan(w.start);
  });

  it('copes with zero-height items', () => {
    const heights = (i: number) => (i % 3 === 0 ? 0 : 120);
    const w = computeWindow({ count: 60, heightAt: heights, viewportTop: 600, viewportHeight: 600, overscanPx: 0 });
    let rendered = 0;
    for (let i = w.start; i < w.end; i++) rendered += heights(i);
    expect(w.padTop + rendered + w.padBottom).toBe(w.total);
  });

  it('start never moves backwards as the viewport scrolls down', () => {
    const heights = (i: number) => 60 + ((i * 53) % 200);
    let last = -1;
    for (let top = 0; top < 15000; top += 50) {
      const w = computeWindow({ count: 200, heightAt: heights, viewportTop: top, viewportHeight: 700, overscanPx: 200 });
      expect(w.start).toBeGreaterThanOrEqual(last);
      last = w.start;
    }
  });

  it('renders a bounded slice however long the list gets', () => {
    for (const count of [100, 1000, 10000]) {
      const w = computeWindow({ count, heightAt: uniform(120), viewportTop: 3000, viewportHeight: 800, overscanPx: 600 });
      expect(w.end - w.start).toBeLessThanOrEqual(18);
    }
  });
});

describe('HeightCache', () => {
  it('returns the estimate until a real height is recorded', () => {
    const c = new HeightCache(220);
    expect(c.get('a')).toBe(220);
    c.set('a', 431);
    expect(c.get('a')).toBe(431);
  });

  it('ignores zero and negative heights', () => {
    const c = new HeightCache(220);
    expect(c.set('a', 0)).toBe(false);
    expect(c.set('a', -5)).toBe(false);
    expect(c.get('a')).toBe(220);
  });

  it('ignores sub-pixel churn', () => {
    const c = new HeightCache(220);
    c.set('a', 300);
    expect(c.set('a', 300.4)).toBe(false);
    expect(c.set('a', 302)).toBe(true);
  });

  it('keys by item id so heights survive a prepend', () => {
    const c = new HeightCache(220);
    c.set('post-b', 500);
    // 'post-b' moved from index 0 to index 1; the height still applies.
    expect(c.get('post-b')).toBe(500);
  });

  it('retain drops entries no longer in the list', () => {
    const c = new HeightCache(220);
    c.set('a', 300); c.set('b', 400); c.set('c', 500);
    c.retain(['b', 'c']);
    expect(c.size).toBe(2);
    expect(c.get('b')).toBe(400);
    // 'a' is forgotten, so it falls back to the estimate — which is now the
    // mean of what remains (400, 500), not the constructor's starting guess.
    expect(c.get('a')).toBe(450);
  });

  it('retain accepts a Set', () => {
    const c = new HeightCache(100);
    c.set('a', 300); c.set('b', 400);
    c.retain(new Set(['a']));
    expect(c.size).toBe(1);
  });
});

describe('HeightCache adaptive estimate', () => {
  it('uses the fallback before anything is measured', () => {
    const c = new HeightCache(240);
    expect(c.estimate).toBe(240);
    expect(c.get('unseen')).toBe(240);
  });

  it('estimates unmeasured items from the mean of measured ones', () => {
    const c = new HeightCache(240);
    c.set('a', 100);
    c.set('b', 200);
    expect(c.estimate).toBe(150);
    expect(c.get('unseen')).toBe(150);
    expect(c.get('a')).toBe(100);
  });

  it('keeps the mean correct when a height is revised', () => {
    const c = new HeightCache(240);
    c.set('a', 100);
    c.set('b', 300);
    expect(c.estimate).toBe(200);
    c.set('a', 500);            // image loaded, row grew
    expect(c.estimate).toBe(400);
  });

  it('keeps the mean correct after retain drops entries', () => {
    const c = new HeightCache(240);
    c.set('a', 100); c.set('b', 200); c.set('c', 900);
    c.retain(['a', 'b']);
    expect(c.estimate).toBe(150);
  });

  it('falls back again once everything is dropped', () => {
    const c = new HeightCache(240);
    c.set('a', 100);
    c.retain([]);
    expect(c.size).toBe(0);
    expect(c.estimate).toBe(240);
  });

  it('converges on the true total as items are measured', () => {
    const real = (i: number) => 120 + ((i * 41) % 180);
    const c = new HeightCache(500); // deliberately bad starting guess
    const count = 400;
    const totalWith = () => {
      let t = 0;
      for (let i = 0; i < count; i++) t += c.get(`i${i}`);
      return t;
    };
    let actual = 0;
    for (let i = 0; i < count; i++) actual += real(i);

    for (let i = 0; i < 20; i++) c.set(`i${i}`, real(i));
    const errAfter20 = Math.abs(totalWith() - actual) / actual;
    for (let i = 20; i < 100; i++) c.set(`i${i}`, real(i));
    const errAfter100 = Math.abs(totalWith() - actual) / actual;

    expect(errAfter20).toBeLessThan(0.15);
    expect(errAfter100).toBeLessThan(errAfter20);
  });
});
