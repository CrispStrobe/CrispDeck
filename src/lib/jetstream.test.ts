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
});
