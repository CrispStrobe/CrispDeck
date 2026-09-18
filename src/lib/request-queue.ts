/**
 * Bounded-concurrency queue with in-flight de-duplication.
 *
 * The deck loads every column at once — on mount, on manual refresh, and every
 * three minutes — and each column fans out across every account on its
 * platform. Six columns and three accounts is around eighteen simultaneous
 * requests, repeatedly, against APIs that rate-limit. The failures were caught
 * per-column, so the visible result was columns quietly coming up empty.
 *
 * Two things fix that: a ceiling on how many requests are in flight, and
 * collapsing duplicate work — a manual refresh landing on top of an auto
 * refresh should join the running request rather than start a second one.
 */

interface Pending<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class RequestQueue {
  private active = 0;
  private queue: Pending<any>[] = [];
  /** key -> promise of the request currently running or queued for it. */
  private inflight = new Map<string, Promise<any>>();

  constructor(private concurrency = 4) {
    if (concurrency < 1) throw new Error('concurrency must be at least 1');
  }

  /**
   * Run `task`, waiting for a free slot.
   *
   * When `key` is given and an identical task is already in flight, the
   * existing promise is returned and `task` never runs. Pass null to opt out.
   */
  run<T>(key: string | null, task: () => Promise<T>): Promise<T> {
    if (key !== null) {
      const existing = this.inflight.get(key);
      if (existing) return existing as Promise<T>;
    }

    const promise = new Promise<T>((resolve, reject) => {
      this.queue.push({ run: task, resolve, reject });
      this.pump();
    });

    if (key !== null) {
      this.inflight.set(key, promise);
      // Clear the key whether it settled or failed, without swallowing either.
      const clear = () => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      };
      promise.then(clear, clear);
    }
    return promise;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active++;
      let started: Promise<unknown>;
      try {
        started = next.run();
      } catch (error) {
        // A task that throws synchronously must not wedge the queue.
        this.active--;
        next.reject(error);
        continue;
      }
      Promise.resolve(started).then(
        (value) => { this.active--; next.resolve(value as never); this.pump(); },
        (error) => { this.active--; next.reject(error); this.pump(); }
      );
    }
  }

  /** Requests currently running. */
  get activeCount(): number {
    return this.active;
  }

  /** Requests waiting for a slot. */
  get queuedCount(): number {
    return this.queue.length;
  }
}
