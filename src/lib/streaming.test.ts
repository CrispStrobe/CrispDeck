import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MastodonStream, BlueskyStream, streamManager, type StreamEvent } from './streaming';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
  onmessage: ((event: any) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate connection
    setTimeout(() => { this.readyState = 1; }, 0);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  // Test helper: simulate incoming message
  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket as any);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  streamManager.disconnectAll();
});

describe('MastodonStream', () => {
  it('connects to correct WebSocket URL', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token123', 'user');
    stream.setEnabled(true);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('wss://mastodon.social/api/v1/streaming');
    expect(MockWebSocket.instances[0].url).toContain('access_token=token123');
    expect(MockWebSocket.instances[0].url).toContain('stream=user');

    stream.disconnect();
  });

  it('emits new-post events on update messages', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    const ws = MockWebSocket.instances[0];
    ws.simulateMessage({
      event: 'update',
      payload: JSON.stringify({ id: '123', content: 'hello' }),
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('new-post');
    expect(listener.mock.calls[0][0].platform).toBe('mastodon');
    expect(listener.mock.calls[0][0].payload.id).toBe('123');

    stream.disconnect();
  });

  it('emits delete events', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    MockWebSocket.instances[0].simulateMessage({
      event: 'delete',
      payload: '456',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('delete');
    expect(listener.mock.calls[0][0].payload.id).toBe('456');

    stream.disconnect();
  });

  it('emits update events on status.update', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    MockWebSocket.instances[0].simulateMessage({
      event: 'status.update',
      payload: JSON.stringify({ id: '789', content: 'edited' }),
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('update');

    stream.disconnect();
  });

  it('reconnects after disconnect when enabled', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    stream.setEnabled(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    // Simulate close
    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(5000);

    expect(MockWebSocket.instances).toHaveLength(2);
    stream.disconnect();
  });

  it('does not reconnect when disabled', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    stream.setEnabled(true);
    stream.disconnect();

    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('unsubscribe removes listener', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    const listener = vi.fn();
    const unsub = stream.subscribe(listener);
    stream.setEnabled(true);

    unsub();

    MockWebSocket.instances[0].simulateMessage({
      event: 'update',
      payload: JSON.stringify({ id: '1' }),
    });
    expect(listener).not.toHaveBeenCalled();

    stream.disconnect();
  });

  it('ignores malformed messages', () => {
    const stream = new (MastodonStream as any)('https://mastodon.social', 'token', 'user');
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    // Send non-JSON
    MockWebSocket.instances[0].onmessage?.({ data: 'not json' });
    expect(listener).not.toHaveBeenCalled();

    stream.disconnect();
  });
});

describe('BlueskyStream', () => {
  it('connects to Jetstream with post collection', () => {
    const stream = new (BlueskyStream as any)();
    stream.setEnabled(true);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('jetstream2.us-east.bsky.network');
    expect(MockWebSocket.instances[0].url).toContain('wantedCollections=app.bsky.feed.post');

    stream.disconnect();
  });

  it('includes watched DIDs in connection params', () => {
    const stream = new (BlueskyStream as any)();
    stream.watchDid('did:plc:abc123');
    stream.watchDid('did:plc:def456');
    stream.setEnabled(true);

    const url = MockWebSocket.instances[0].url;
    expect(url).toContain('wantedDids=did%3Aplc%3Aabc123');
    expect(url).toContain('wantedDids=did%3Aplc%3Adef456');

    stream.disconnect();
  });

  it('emits new-post events for created posts', () => {
    const stream = new (BlueskyStream as any)();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    MockWebSocket.instances[0].simulateMessage({
      did: 'did:plc:abc',
      commit: {
        collection: 'app.bsky.feed.post',
        operation: 'create',
        rkey: 'post123',
        cid: 'cid123',
        record: { text: 'hello world', createdAt: new Date().toISOString() },
      },
    });

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0][0] as StreamEvent;
    expect(event.type).toBe('new-post');
    expect(event.platform).toBe('bluesky');
    expect(event.payload.uri).toBe('at://did:plc:abc/app.bsky.feed.post/post123');

    stream.disconnect();
  });

  it('emits delete events', () => {
    const stream = new (BlueskyStream as any)();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    MockWebSocket.instances[0].simulateMessage({
      did: 'did:plc:abc',
      commit: {
        collection: 'app.bsky.feed.post',
        operation: 'delete',
        rkey: 'post123',
      },
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('delete');

    stream.disconnect();
  });

  it('ignores non-post collections', () => {
    const stream = new (BlueskyStream as any)();
    const listener = vi.fn();
    stream.subscribe(listener);
    stream.setEnabled(true);

    MockWebSocket.instances[0].simulateMessage({
      did: 'did:plc:abc',
      commit: {
        collection: 'app.bsky.feed.like',
        operation: 'create',
        record: { subject: { uri: 'at://...' } },
      },
    });

    expect(listener).not.toHaveBeenCalled();
    stream.disconnect();
  });

  it('watchDid and unwatchDid manage watched set', () => {
    const stream = new (BlueskyStream as any)();
    stream.watchDid('did:plc:1');
    stream.watchDid('did:plc:2');
    stream.unwatchDid('did:plc:1');
    stream.setEnabled(true);

    const url = MockWebSocket.instances[0].url;
    expect(url).not.toContain('did%3Aplc%3A1');
    expect(url).toContain('did%3Aplc%3A2');

    stream.disconnect();
  });

  it('clearWatched removes all DIDs', () => {
    const stream = new (BlueskyStream as any)();
    stream.watchDid('did:plc:1');
    stream.watchDid('did:plc:2');
    stream.clearWatched();
    stream.setEnabled(true);

    const url = MockWebSocket.instances[0].url;
    expect(url).not.toContain('wantedDids');

    stream.disconnect();
  });
});

describe('streamManager', () => {
  it('enableColumn returns cleanup function', () => {
    const listener = vi.fn();
    const cleanup = streamManager.enableColumn({
      columnId: 'col-1',
      platform: 'mastodon',
      instanceUrl: 'https://mastodon.social',
      accessToken: 'token',
      streamType: 'user',
    }, listener);

    expect(typeof cleanup).toBe('function');
    expect(streamManager.isColumnStreaming('col-1')).toBe(true);

    cleanup();
    expect(streamManager.isColumnStreaming('col-1')).toBe(false);
  });

  it('enableColumn for bluesky creates stream', () => {
    const listener = vi.fn();
    const cleanup = streamManager.enableColumn({
      columnId: 'col-bsky',
      platform: 'bluesky',
    }, listener);

    expect(streamManager.isColumnStreaming('col-bsky')).toBe(true);
    cleanup();
  });

  it('disableColumn stops streaming', () => {
    const listener = vi.fn();
    streamManager.enableColumn({
      columnId: 'col-1',
      platform: 'bluesky',
    }, listener);

    expect(streamManager.isColumnStreaming('col-1')).toBe(true);
    streamManager.disableColumn('col-1');
    expect(streamManager.isColumnStreaming('col-1')).toBe(false);
  });

  it('disconnectAll clears everything', () => {
    streamManager.enableColumn({ columnId: 'a', platform: 'bluesky' }, vi.fn());
    streamManager.enableColumn({
      columnId: 'b',
      platform: 'mastodon',
      instanceUrl: 'https://m.social',
      accessToken: 'tok',
    }, vi.fn());

    streamManager.disconnectAll();
    expect(streamManager.isColumnStreaming('a')).toBe(false);
    expect(streamManager.isColumnStreaming('b')).toBe(false);
  });

  it('tags events with columnId', () => {
    const listener = vi.fn();
    streamManager.enableColumn({
      columnId: 'col-masto',
      platform: 'mastodon',
      instanceUrl: 'https://mastodon.social',
      accessToken: 'token',
    }, listener);

    // Simulate message on the WebSocket
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.simulateMessage({
      event: 'update',
      payload: JSON.stringify({ id: '1', content: 'test' }),
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].columnId).toBe('col-masto');
  });

  it('returns no-op cleanup for unsupported platform config', () => {
    const listener = vi.fn();
    const cleanup = streamManager.enableColumn({
      columnId: 'col-threads',
      platform: 'mastodon', // mastodon but no instanceUrl
    }, listener);

    expect(typeof cleanup).toBe('function');
    cleanup(); // should not throw
  });

  it('firehose creates separate BlueskyStream from regular', () => {
    const firehoseListener = vi.fn();
    const regularListener = vi.fn();

    const cleanup1 = streamManager.enableColumn({
      columnId: 'col-firehose',
      platform: 'bluesky',
      firehose: true,
    }, firehoseListener);

    const cleanup2 = streamManager.enableColumn({
      columnId: 'col-regular',
      platform: 'bluesky',
    }, regularListener);

    // Both should be streaming independently
    expect(streamManager.isColumnStreaming('col-firehose')).toBe(true);
    expect(streamManager.isColumnStreaming('col-regular')).toBe(true);

    // Two separate WebSocket connections (one firehose, one regular)
    expect(MockWebSocket.instances).toHaveLength(2);

    cleanup1();
    cleanup2();
  });

  it('firehose stream receives events independently', () => {
    const firehoseListener = vi.fn();

    const cleanup = streamManager.enableColumn({
      columnId: 'col-keyword',
      platform: 'bluesky',
      firehose: true,
    }, firehoseListener);

    // Simulate message on the firehose WebSocket
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.simulateMessage({
      did: 'did:plc:random',
      commit: {
        collection: 'app.bsky.feed.post',
        operation: 'create',
        rkey: 'abc',
        cid: 'cid1',
        record: { text: 'hello svelte', createdAt: new Date().toISOString() },
      },
    });

    expect(firehoseListener).toHaveBeenCalledOnce();
    expect(firehoseListener.mock.calls[0][0].columnId).toBe('col-keyword');
    expect(firehoseListener.mock.calls[0][0].payload.did).toBe('did:plc:random');

    cleanup();
  });

  it('disconnectAll cleans up firehose stream too', () => {
    streamManager.enableColumn({ columnId: 'fh1', platform: 'bluesky', firehose: true }, vi.fn());
    streamManager.enableColumn({ columnId: 'reg1', platform: 'bluesky' }, vi.fn());

    streamManager.disconnectAll();
    expect(streamManager.isColumnStreaming('fh1')).toBe(false);
    expect(streamManager.isColumnStreaming('reg1')).toBe(false);
  });
});
