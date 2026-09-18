import { describe, it, expect, vi } from 'vitest';
import { RequestQueue } from './request-queue';

/** A task whose completion the test controls. */
function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('RequestQueue concurrency', () => {
  it('runs up to the limit and queues the rest', async () => {
    const q = new RequestQueue(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];

    const all = gates.map((g, i) =>
      q.run(null, async () => { started.push(i); await g.promise; return i })
    );

    await tick();
    expect(started).toEqual([0, 1]);
    expect(q.activeCount).toBe(2);
    expect(q.queuedCount).toBe(2);

    gates[0].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve(); gates[2].resolve(); gates[3].resolve();
    expect(await Promise.all(all)).toEqual([0, 1, 2, 3]);
    expect(q.activeCount).toBe(0);
  });

  it('never exceeds the limit under load', async () => {
    const q = new RequestQueue(3);
    let peak = 0;
    await Promise.all(Array.from({ length: 30 }, () =>
      q.run(null, async () => {
        peak = Math.max(peak, q.activeCount);
        await tick();
      })
    ));
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('runs everything serially at concurrency 1', async () => {
    const q = new RequestQueue(1);
    const order: string[] = [];
    await Promise.all(['a', 'b', 'c'].map((n) =>
      q.run(null, async () => { order.push(`${n}-start`); await tick(); order.push(`${n}-end`); })
    ));
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end', 'c-start', 'c-end']);
  });

  it('rejects a concurrency below 1', () => {
    expect(() => new RequestQueue(0)).toThrow();
  });
});

describe('RequestQueue de-duplication', () => {
  it('collapses identical in-flight requests', async () => {
    const q = new RequestQueue(4);
    const gate = deferred<string>();
    const task = vi.fn(async () => gate.promise);

    const a = q.run('col:1', task);
    const b = q.run('col:1', task);
    expect(a).toBe(b);
    expect(task).toHaveBeenCalledTimes(1);

    gate.resolve('done');
    expect(await a).toBe('done');
    expect(await b).toBe('done');
  });

  it('does not collapse different keys', async () => {
    const q = new RequestQueue(4);
    const task = vi.fn(async () => 'x');
    await Promise.all([q.run('col:1', task), q.run('col:2', task)]);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('allows a fresh request once the previous one settles', async () => {
    const q = new RequestQueue(4);
    const task = vi.fn(async () => 'x');
    await q.run('col:1', task);
    await q.run('col:1', task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('clears the key after a failure so a retry is possible', async () => {
    const q = new RequestQueue(4);
    const failing = vi.fn(async () => { throw new Error('boom'); });
    await expect(q.run('col:1', failing)).rejects.toThrow('boom');
    await expect(q.run('col:1', failing)).rejects.toThrow('boom');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('shares the rejection with every caller that joined', async () => {
    const q = new RequestQueue(4);
    const gate = deferred();
    const task = () => gate.promise;
    const a = q.run('k', task);
    const b = q.run('k', task);
    gate.reject(new Error('nope'));
    await expect(a).rejects.toThrow('nope');
    await expect(b).rejects.toThrow('nope');
  });

  it('opts out of de-duplication with a null key', async () => {
    const q = new RequestQueue(4);
    const task = vi.fn(async () => 'x');
    await Promise.all([q.run(null, task), q.run(null, task)]);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('RequestQueue robustness', () => {
  it('a task that throws synchronously does not wedge the queue', async () => {
    const q = new RequestQueue(1);
    await expect(q.run(null, () => { throw new Error('sync'); })).rejects.toThrow('sync');
    expect(await q.run(null, async () => 'still works')).toBe('still works');
    expect(q.activeCount).toBe(0);
  });

  it('a rejected task frees its slot', async () => {
    const q = new RequestQueue(1);
    const results = await Promise.allSettled([
      q.run(null, async () => { throw new Error('a'); }),
      q.run(null, async () => 'b'),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 'b' });
  });

  it('drains fully', async () => {
    const q = new RequestQueue(2);
    await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      q.run(null, async () => { if (i % 3 === 0) throw new Error('x'); await tick(); })
    ));
    expect(q.activeCount).toBe(0);
    expect(q.queuedCount).toBe(0);
  });
});
