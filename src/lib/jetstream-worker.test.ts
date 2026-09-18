/**
 * The Jetstream client should move the socket into a worker when the platform
 * has one, and degrade to the main thread when it doesn't. A browser check
 * would need a signed-in account (live counters are opt-in and the feed only
 * enables them after clients initialise), so the plumbing is covered here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: any[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  terminated = false;
  constructor(public url: URL | string, public opts?: any) {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: any) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  /** Simulate the worker pushing a decoded update back to the page. */
  emit(msg: any) { this.onmessage?.({ data: msg } as MessageEvent); }
}

const uri = 'at://did:plc:a/app.bsky.feed.post/1';

async function freshClient(withWorker: boolean) {
  vi.resetModules();
  FakeWorker.instances = [];
  if (withWorker) vi.stubGlobal('Worker', FakeWorker as any);
  else vi.stubGlobal('Worker', undefined);
  const mod = await import('./jetstream');
  return mod.jetstream;
}

afterEach(() => vi.unstubAllGlobals());

describe('worker offload', () => {
  it('spawns a module worker when Worker exists', async () => {
    const js = await freshClient(true);
    js.setEnabled(true);

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].opts).toEqual({ type: 'module' });
    expect(String(FakeWorker.instances[0].url)).toContain('jetstream.worker');
    js.setEnabled(false);
  });

  it('tells the worker to connect and disconnect', async () => {
    const js = await freshClient(true);
    js.setEnabled(true);
    js.setEnabled(false);
    expect(FakeWorker.instances[0].posted).toEqual([
      { type: 'setEnabled', enabled: true },
      { type: 'setEnabled', enabled: false },
    ]);
  });

  it('forwards watch and unwatch so the worker can filter', async () => {
    const js = await freshClient(true);
    js.setEnabled(true);
    const off = js.watch(uri, () => {});
    off();
    const w = FakeWorker.instances[0];
    expect(w.posted).toContainEqual({ type: 'watch', uri });
    expect(w.posted).toContainEqual({ type: 'unwatch', uri });
    js.setEnabled(false);
  });

  it('replays already-watched posts to a worker created later', async () => {
    const js = await freshClient(true);
    js.watchPost(uri);          // watched before any connection exists
    js.setEnabled(true);        // worker is created here
    expect(FakeWorker.instances[0].posted).toContainEqual({ type: 'watch', uri });
    js.setEnabled(false);
  });

  it('delivers worker updates to the listener for that post', async () => {
    const js = await freshClient(true);
    js.setEnabled(true);
    const seen: any[] = [];
    js.watch(uri, (u) => seen.push(u));

    FakeWorker.instances[0].emit({ type: 'update', update: { uri, type: 'like', delta: 1 } });

    expect(seen).toEqual([{ uri, type: 'like', delta: 1 }]);
    js.setEnabled(false);
  });

  it('tracks connection status reported by the worker', async () => {
    const js = await freshClient(true);
    js.setEnabled(true);
    expect(js.isConnected()).toBe(false);
    FakeWorker.instances[0].emit({ type: 'status', connected: true });
    expect(js.isConnected()).toBe(true);
    FakeWorker.instances[0].emit({ type: 'status', connected: false });
    expect(js.isConnected()).toBe(false);
    js.setEnabled(false);
  });

  it('falls back to the main thread when Worker is unavailable', async () => {
    const js = await freshClient(false);
    const sockets: any[] = [];
    vi.stubGlobal('WebSocket', class {
      onmessage: any; onclose: any; onerror: any; readyState = 0;
      constructor(public url: string) { sockets.push(this); }
      close() {}
    } as any);

    js.setEnabled(true);
    expect(FakeWorker.instances).toHaveLength(0);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('jetstream2.us-east.bsky.network');
    // And filtering still works inline.
    const seen: any[] = [];
    js.watch(uri, (u) => seen.push(u));
    sockets[0].onmessage({ data: JSON.stringify({
      commit: { operation: 'create', collection: 'app.bsky.feed.like',
                record: { subject: { uri } } } }) });
    expect(seen).toEqual([{ uri, type: 'like', delta: 1 }]);
    js.setEnabled(false);
  });

  it('falls back to the main thread if the worker errors', async () => {
    const js = await freshClient(true);
    const sockets: any[] = [];
    vi.stubGlobal('WebSocket', class {
      onmessage: any; onclose: any; onerror: any; readyState = 0;
      constructor(public url: string) { sockets.push(this); }
      close() {}
    } as any);

    js.setEnabled(true);
    expect(FakeWorker.instances).toHaveLength(1);

    FakeWorker.instances[0].onerror?.({ message: 'boom' });

    expect(sockets).toHaveLength(1); // reconnected without the worker
    js.setEnabled(false);
  });
});
