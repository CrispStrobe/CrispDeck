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
  type: 'new-post' | 'delete' | 'update';
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

    try {
      const wsUrl = this.instanceUrl.replace(/^http/, 'ws');
      this.ws = new WebSocket(
        `${wsUrl}/api/v1/streaming?access_token=${this.accessToken}&stream=${this.streamType}`,
      );

      this.ws.onmessage = (event) => {
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

      this.ws.onclose = () => {
        this.ws = null;
        if (this.enabled) {
          this.reconnectTimer = setTimeout(() => this.connect(), 5000);
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // WebSocket not available or blocked
    }
  }

  disconnect() {
    this.enabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
}

// ── Bluesky Jetstream streaming (new posts) ─────────────────────────────────

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

class BlueskyStream {
  private ws: WebSocket | null = null;
  private listeners = new Set<StreamListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private watchedDids = new Set<string>();

  connect() {
    if (this.ws || !this.enabled) return;

    try {
      const params = new URLSearchParams({
        wantedCollections: 'app.bsky.feed.post',
      });
      // Filter by DIDs we're following
      for (const did of this.watchedDids) {
        params.append('wantedDids', did);
      }
      this.ws = new WebSocket(`${JETSTREAM_URL}?${params}`);

      this.ws.onmessage = (event) => {
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

      this.ws.onclose = () => {
        this.ws = null;
        if (this.enabled) {
          this.reconnectTimer = setTimeout(() => this.connect(), 5000);
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // WebSocket not available or blocked
    }
  }

  disconnect() {
    this.enabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
  private wasConnected = false; // track if we were streaming before hiding

  /** Enable streaming for a deck column */
  enableColumn(config: ColumnStreamConfig, listener: StreamListener): () => void {
    this.ensureVisibilityHandler();
    const taggedListener: StreamListener = (event) => {
      listener({ ...event, columnId: config.columnId });
    };

    if (config.platform === 'mastodon' && config.instanceUrl && config.accessToken) {
      const streamKey = `${config.instanceUrl}:${config.streamType ?? 'user'}:${config.streamParam ?? ''}`;
      let stream = this.mastodonStreams.get(streamKey);
      if (!stream) {
        let streamType = config.streamType ?? 'user';
        if (config.streamParam) {
          streamType = `${streamType}&${streamType === 'hashtag' ? 'tag' : 'list'}=${config.streamParam}`;
        }
        stream = new MastodonStream(config.instanceUrl, config.accessToken, streamType);
        this.mastodonStreams.set(streamKey, stream);
      }
      const unsub = stream.subscribe(taggedListener);
      stream.setEnabled(true);

      this.columnListeners.set(config.columnId, unsub);
      return () => {
        unsub();
        this.columnListeners.delete(config.columnId);
      };
    }

    if (config.platform === 'bluesky') {
      // Firehose mode: unfiltered Jetstream for keyword monitoring (no wantedDids)
      // Separate from DID-filtered stream so they don't interfere
      if (config.firehose) {
        if (!this.blueskyFirehose) {
          this.blueskyFirehose = new BlueskyStream();
        }
        const unsub = this.blueskyFirehose.subscribe(taggedListener);
        this.blueskyFirehose.setEnabled(true);

        this.columnListeners.set(config.columnId, unsub);
        return () => {
          unsub();
          this.columnListeners.delete(config.columnId);
        };
      }

      if (!this.blueskyStream) {
        this.blueskyStream = new BlueskyStream();
      }
      const unsub = this.blueskyStream.subscribe(taggedListener);
      this.blueskyStream.setEnabled(true);

      this.columnListeners.set(config.columnId, unsub);
      return () => {
        unsub();
        this.columnListeners.delete(config.columnId);
      };
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
        this.wasConnected = this.columnListeners.size > 0;
        for (const [, stream] of this.mastodonStreams) stream.setEnabled(false);
        this.blueskyStream?.setEnabled(false);
        this.blueskyFirehose?.setEnabled(false);
      } else if (this.wasConnected) {
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
