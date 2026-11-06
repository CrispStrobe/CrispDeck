/**
 * Streaming timelines for deck columns.
 *
 * Bluesky: Extends Jetstream WebSocket to stream new posts (not just counters).
 * Mastodon: Uses the /api/v1/streaming WebSocket endpoint.
 *
 * Each stream emits normalized events that deck columns can subscribe to.
 * Opt-in per column via a `streaming` toggle.
 */

export interface StreamEvent {
  type: 'new-post' | 'delete' | 'update' | 'notification';
  platform: 'bluesky' | 'mastodon';
  payload: any; // raw post data — caller normalizes via normalizePost
  columnId?: string;
}

type StreamListener = (event: StreamEvent) => void;

// ── Mastodon streaming ──────────────────────────────────────────────────────

class MastodonStream {
  private ws: WebSocket | null = null;
  private listeners = new Set<StreamListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private reconnectAttempts = 0;
  private instanceUrl: string;
  private accessToken: string;
  private streamType: string;

  constructor(instanceUrl: string, accessToken: string, streamType = 'user') {
    this.instanceUrl = instanceUrl.replace(/\/$/, '');
    this.accessToken = accessToken;
    this.streamType = streamType;
  }

  connect() {
    if (this.ws || !this.enabled) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

    try {
      const wsUrl = this.instanceUrl.replace(/^http/, 'ws');
      const [streamName, ...parameters] = this.streamType.split('&');
      const query = new URLSearchParams(parameters.join('&'));
      query.set('access_token', this.accessToken);
      query.set('stream', streamName);
      const socket = new WebSocket(`${wsUrl}/api/v1/streaming?${query}`);
      this.ws = socket;

      socket.onopen = () => { if (this.ws === socket) this.reconnectAttempts = 0; };

      socket.onmessage = (event) => {
        if (this.ws !== socket || !this.enabled) return;
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'update' && data.payload) {
            const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
            const streamEvent: StreamEvent = {
              type: 'new-post',
              platform: 'mastodon',
              payload,
            };
            for (const listener of this.listeners) {
              listener(streamEvent);
            }
          } else if (data.event === 'notification' && data.payload) {
            const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
            for (const listener of this.listeners) listener({ type: 'notification', platform: 'mastodon', payload });
          } else if (data.event === 'delete') {
            const streamEvent: StreamEvent = {
              type: 'delete',
              platform: 'mastodon',
              payload: { id: data.payload },
            };
            for (const listener of this.listeners) {
              listener(streamEvent);
            }
          } else if (data.event === 'status.update' && data.payload) {
            const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
            const streamEvent: StreamEvent = {
              type: 'update',
              platform: 'mastodon',
              payload,
            };
            for (const listener of this.listeners) {
              listener(streamEvent);
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.ws = null;
        if (this.enabled) {
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
        }
      };

      socket.onerror = () => {
        if (this.ws === socket) socket.close();
      };
    } catch {
      // WebSocket not available or blocked
    }
  }

  disconnect() {
    this.enabled = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && !this.ws) {
      this.connect();
    } else if (!enabled) {
      this.disconnect();
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasListeners(): boolean { return this.listeners.size > 0; }
}

// ── Bluesky Jetstream streaming (new posts) ─────────────────────────────────

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

class BlueskyStream {
  private ws: WebSocket | null = null;
  private listeners = new Set<StreamListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private reconnectAttempts = 0;
  private watchedDids = new Set<string>();

  connect() {
    if (this.ws || !this.enabled) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

    try {
      const params = new URLSearchParams({
        wantedCollections: 'app.bsky.feed.post',
      });
      // Filter by DIDs we're following
      for (const did of this.watchedDids) {
        params.append('wantedDids', did);
      }
      const socket = new WebSocket(`${JETSTREAM_URL}?${params}`);
      this.ws = socket;

      socket.onopen = () => { if (this.ws === socket) this.reconnectAttempts = 0; };

      socket.onmessage = (event) => {
        if (this.ws !== socket || !this.enabled) return;
        try {
          const data = JSON.parse(event.data);
          if (!data.commit) return;

          const { collection, operation, record } = data.commit;
          if (collection !== 'app.bsky.feed.post') return;

          if (operation === 'create' && record) {
            const streamEvent: StreamEvent = {
              type: 'new-post',
              platform: 'bluesky',
              payload: {
                did: data.did,
                record,
                uri: `at://${data.did}/${collection}/${data.commit.rkey}`,
                cid: data.commit.cid,
              },
            };
            for (const listener of this.listeners) {
              listener(streamEvent);
            }
          } else if (operation === 'delete') {
            const streamEvent: StreamEvent = {
              type: 'delete',
              platform: 'bluesky',
              payload: {
                uri: `at://${data.did}/${collection}/${data.commit.rkey}`,
              },
            };
            for (const listener of this.listeners) {
              listener(streamEvent);
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.ws = null;
        if (this.enabled) {
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
        }
      };

      socket.onerror = () => {
        if (this.ws === socket) socket.close();
      };
    } catch {
      // WebSocket not available or blocked
    }
  }

  disconnect() {
    this.enabled = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && !this.ws) {
      this.connect();
    } else if (!enabled) {
      this.disconnect();
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === 1;
  }

  /** Watch posts from specific DIDs (Bluesky user identifiers) */
  watchDid(did: string) {
    this.watchedDids.add(did);
  }

  unwatchDid(did: string) {
    this.watchedDids.delete(did);
  }

  clearWatched() {
    this.watchedDids.clear();
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasListeners(): boolean { return this.listeners.size > 0; }
}

// ── Stream manager (coordinates per-column streams) ─────────────────────────

export interface ColumnStreamConfig {
  columnId: string;
  platform: 'bluesky' | 'mastodon';
  instanceUrl?: string;
  accessToken?: string;
  streamType?: string; // 'user', 'public', 'public:local', 'hashtag', 'list'
  streamParam?: string; // for hashtag: tag name, for list: list ID
  firehose?: boolean; // Bluesky only: use unfiltered Jetstream (no DID filter) for keyword monitoring
}

class StreamManager {
  private mastodonStreams = new Map<string, MastodonStream>();
  private blueskyStream: BlueskyStream | null = null;
  private blueskyFirehose: BlueskyStream | null = null; // Separate unfiltered stream for keyword monitoring
  private columnListeners = new Map<string, () => void>(); // cleanup fns
  private visibilityHandler: (() => void) | null = null;

  /** Enable streaming for a deck column */
  enableColumn(config: ColumnStreamConfig, listener: StreamListener): () => void {
    this.disableColumn(config.columnId);
    this.ensureVisibilityHandler();
    const taggedListener: StreamListener = (event) => {
      listener({ ...event, columnId: config.columnId });
    };

    if (config.platform === 'mastodon' && config.instanceUrl && config.accessToken) {
      // Two accounts on the same instance must never share a private user stream.
      const streamKey = `${config.instanceUrl}:${config.accessToken}:${config.streamType ?? 'user'}:${config.streamParam ?? ''}`;
      let stream = this.mastodonStreams.get(streamKey);
      if (!stream) {
        let streamType = config.streamType ?? 'user';
        if (config.streamParam) {
          streamType = `${streamType}&${streamType === 'hashtag' ? 'tag' : 'list'}=${encodeURIComponent(config.streamParam)}`;
        }
        stream = new MastodonStream(config.instanceUrl, config.accessToken, streamType);
        this.mastodonStreams.set(streamKey, stream);
      }
      const unsub = stream.subscribe(taggedListener);
      stream.setEnabled(typeof document === 'undefined' || !document.hidden);

      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        unsub();
        if (this.columnListeners.get(config.columnId) === cleanup) this.columnListeners.delete(config.columnId);
        if (!stream.hasListeners()) { stream.disconnect(); this.mastodonStreams.delete(streamKey); }
      };
      this.columnListeners.set(config.columnId, cleanup);
      return cleanup;
    }

    if (config.platform === 'bluesky') {
      // Firehose mode: unfiltered Jetstream for keyword monitoring (no wantedDids)
      // Separate from DID-filtered stream so they don't interfere
      if (config.firehose) {
        if (!this.blueskyFirehose) {
          this.blueskyFirehose = new BlueskyStream();
        }
        const unsub = this.blueskyFirehose.subscribe(taggedListener);
        const stream = this.blueskyFirehose;
        stream.setEnabled(typeof document === 'undefined' || !document.hidden);

        let disposed = false;
        const cleanup = () => {
          if (disposed) return;
          disposed = true;
          unsub();
          if (this.columnListeners.get(config.columnId) === cleanup) this.columnListeners.delete(config.columnId);
          if (!stream.hasListeners()) { stream.disconnect(); if (this.blueskyFirehose === stream) this.blueskyFirehose = null; }
        };
        this.columnListeners.set(config.columnId, cleanup);
        return cleanup;
      }

      if (!this.blueskyStream) {
        this.blueskyStream = new BlueskyStream();
      }
      const unsub = this.blueskyStream.subscribe(taggedListener);
      const stream = this.blueskyStream;
      stream.setEnabled(typeof document === 'undefined' || !document.hidden);

      let disposed = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        unsub();
        if (this.columnListeners.get(config.columnId) === cleanup) this.columnListeners.delete(config.columnId);
        if (!stream.hasListeners()) { stream.disconnect(); if (this.blueskyStream === stream) this.blueskyStream = null; }
      };
      this.columnListeners.set(config.columnId, cleanup);
      return cleanup;
    }

    // No-op cleanup for unsupported configs
    return () => {};
  }

  /** Disable streaming for a specific column */
  disableColumn(columnId: string) {
    const cleanup = this.columnListeners.get(columnId);
    if (cleanup) {
      cleanup();
      this.columnListeners.delete(columnId);
    }
  }

  /** Disconnect all streams */
  disconnectAll() {
    for (const [, stream] of this.mastodonStreams) {
      stream.disconnect();
    }
    this.mastodonStreams.clear();
    this.blueskyStream?.disconnect();
    this.blueskyStream = null;
    this.blueskyFirehose?.disconnect();
    this.blueskyFirehose = null;
    this.columnListeners.clear();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /** Install visibility handler to pause/resume streams when tab hidden/visible */
  private ensureVisibilityHandler() {
    if (this.visibilityHandler || typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.hidden) {
        // Pause all streams to save bandwidth
        for (const [, stream] of this.mastodonStreams) stream.setEnabled(false);
        this.blueskyStream?.setEnabled(false);
        this.blueskyFirehose?.setEnabled(false);
      } else {
        // Resume streams when tab becomes visible
        for (const [, stream] of this.mastodonStreams) stream.setEnabled(true);
        this.blueskyStream?.setEnabled(true);
        this.blueskyFirehose?.setEnabled(true);
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /** Check if a column is streaming */
  isColumnStreaming(columnId: string): boolean {
    return this.columnListeners.has(columnId);
  }
}

/** Singleton stream manager */
export const streamManager = new StreamManager();

// Re-export classes for testing
export { MastodonStream, BlueskyStream };
