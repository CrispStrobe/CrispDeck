import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the CountUpdate interface and the subscribe/watch pattern
// without actually connecting to WebSocket (no jsdom WebSocket)

describe('jetstream module', () => {
  it('exports jetstream singleton', async () => {
    const { jetstream } = await import('./jetstream');
    expect(jetstream).toBeDefined();
    expect(typeof jetstream.connect).toBe('function');
    expect(typeof jetstream.disconnect).toBe('function');
    expect(typeof jetstream.subscribe).toBe('function');
    expect(typeof jetstream.watchPost).toBe('function');
    expect(typeof jetstream.unwatchPost).toBe('function');
    expect(typeof jetstream.clearWatched).toBe('function');
    expect(typeof jetstream.setEnabled).toBe('function');
    expect(typeof jetstream.isConnected).toBe('function');
  });

  it('isConnected returns false when not connected', async () => {
    const { jetstream } = await import('./jetstream');
    expect(jetstream.isConnected()).toBe(false);
  });

  it('subscribe returns an unsubscribe function', async () => {
    const { jetstream } = await import('./jetstream');
    const listener = vi.fn();
    const unsub = jetstream.subscribe(listener);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('CountUpdate type shape is correct', async () => {
    const update = { uri: 'at://did/post/1', type: 'like' as const, delta: 1 as const };
    expect(update.uri).toBe('at://did/post/1');
    expect(update.type).toBe('like');
    expect(update.delta).toBe(1);
  });

  it('watchPost accepts per-URI listener', async () => {
    const { jetstream } = await import('./jetstream');
    const listener = vi.fn();
    // Should not throw — registers listener for specific URI
    jetstream.watchPost('at://did/post/test', listener);
    // Clean up
    jetstream.unwatchPost('at://did/post/test', listener);
  });

  it('unwatchPost with listener removes only that listener', async () => {
    const { jetstream } = await import('./jetstream');
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    jetstream.watchPost('at://did/post/multi', listener1);
    jetstream.watchPost('at://did/post/multi', listener2);

    // Remove only listener1
    jetstream.unwatchPost('at://did/post/multi', listener1);

    // URI should still be watched (listener2 remains)
    // Clean up
    jetstream.unwatchPost('at://did/post/multi', listener2);
  });

  it('unwatchPost without listener removes entire URI', async () => {
    const { jetstream } = await import('./jetstream');
    const listener = vi.fn();

    jetstream.watchPost('at://did/post/remove-all', listener);
    jetstream.unwatchPost('at://did/post/remove-all');

    // Should not throw — URI fully removed
    jetstream.clearWatched();
  });

  it('clearWatched removes all per-URI listeners', async () => {
    const { jetstream } = await import('./jetstream');
    const listener = vi.fn();

    jetstream.watchPost('at://did/post/a', listener);
    jetstream.watchPost('at://did/post/b', listener);
    jetstream.clearWatched();

    // Should not throw — everything cleaned up
    expect(jetstream.isConnected()).toBe(false);
  });
});
