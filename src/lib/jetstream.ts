/**
 * Bluesky Jetstream client — subscribes to real-time events
 * for live-updating like/repost counts on posts.
 *
 * Jetstream is a WebSocket firehose that streams AT Protocol events.
 * We filter for like and repost events on posts we're currently displaying.
 *
 * Optimized: uses per-URI listener map so each event only notifies the
 * relevant Post component instead of broadcasting to all subscribers.
 * Pauses WebSocket when the tab is hidden.
 */

export interface CountUpdate {
  uri: string; // post URI that was liked/reposted
  type: 'like' | 'repost';
  delta: 1 | -1; // +1 for create, -1 for delete
}

type CountListener = (update: CountUpdate) => void;

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

class JetstreamClient {
  private ws: WebSocket | null = null;
  /** Per-URI listeners: only the Post watching this URI gets notified */
  private uriListeners = new Map<string, Set<CountListener>>();
  /** Legacy broadcast listeners (for non-per-URI use cases) */
  private listeners = new Set<CountListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private visibilityHandler: (() => void) | null = null;

  /** Start listening for real-time events */
  connect() {
    if (this.ws || !this.enabled) return;
    // Don't connect if tab is hidden
    if (typeof document !== 'undefined' && document.hidden) return;

    try {
      const params = new URLSearchParams({
        wantedCollections: 'app.bsky.feed.like,app.bsky.feed.repost',
      });
      this.ws = new WebSocket(`${JETSTREAM_URL}?${params}`);

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleEvent(data);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (this.enabled && !(typeof document !== 'undefined' && document.hidden)) {
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

  /** Stop listening */
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
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /** Enable/disable the connection */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      if (!this.ws) this.connect();
      // Install visibility handler to pause/resume WebSocket
      if (!this.visibilityHandler && typeof document !== 'undefined') {
        this.visibilityHandler = () => {
          if (document.hidden) {
            // Pause: close WebSocket to save bandwidth
            if (this.reconnectTimer) {
              clearTimeout(this.reconnectTimer);
              this.reconnectTimer = null;
            }
            if (this.ws) {
              this.ws.close();
              this.ws = null;
            }
          } else if (this.enabled && !this.ws) {
            // Resume when tab becomes visible
            this.connect();
          }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
    } else {
      this.disconnect();
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === 1; // WebSocket.OPEN = 1
  }

  /** Register a post URI to watch, with an optional per-URI listener */
  watchPost(uri: string, listener?: CountListener) {
    if (listener) {
      let set = this.uriListeners.get(uri);
      if (!set) { set = new Set(); this.uriListeners.set(uri, set); }
      set.add(listener);
    } else if (!this.uriListeners.has(uri)) {
      this.uriListeners.set(uri, new Set());
    }
  }

  /** Stop watching a post URI, removing a specific listener */
  unwatchPost(uri: string, listener?: CountListener) {
    if (listener) {
      const set = this.uriListeners.get(uri);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.uriListeners.delete(uri);
      }
    } else {
      this.uriListeners.delete(uri);
    }
  }

  /** Clear all watched posts */
  clearWatched() {
    this.uriListeners.clear();
  }

  /** Subscribe to all count updates (broadcast — prefer per-URI watchPost listener) */
  subscribe(listener: CountListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleEvent(data: any) {
    if (!data.commit) return;

    const { collection, operation, record } = data.commit;
    if (!collection || !operation) return;

    let uri: string | undefined;
    let type: 'like' | 'repost' | undefined;

    if (collection === 'app.bsky.feed.like' && record?.subject?.uri) {
      uri = record.subject.uri;
      type = 'like';
    } else if (collection === 'app.bsky.feed.repost' && record?.subject?.uri) {
      uri = record.subject.uri;
      type = 'repost';
    }

    if (!uri || !type) return;

    // Only emit for posts we're watching
    const perUri = this.uriListeners.get(uri);
    if (!perUri && this.listeners.size === 0) return;

    const delta = operation === 'create' ? 1 : operation === 'delete' ? -1 : 0;
    if (delta === 0) return;

    const update: CountUpdate = { uri, type, delta: delta as 1 | -1 };

    // Notify per-URI listeners first (fast path)
    if (perUri) {
      for (const listener of perUri) {
        listener(update);
      }
    }
    // Broadcast listeners (legacy)
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

/** Singleton Jetstream client */
export const jetstream = new JetstreamClient();
