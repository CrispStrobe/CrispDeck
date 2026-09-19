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

/**
 * Remembers which post each like/repost record pointed at.
 *
 * A Jetstream delete commit carries no `record`, so it names only the record
 * being removed:
 *
 *   {"rev":"...","operation":"delete","collection":"app.bsky.feed.like","rkey":"..."}
 *
 * Verified against the live firehose: 80 of 80 deletes seen in 20 seconds had
 * no record. Without a map from record back to subject there is nothing to
 * decrement, so the `delta === -1` branch below was unreachable and counts only
 * ever went up for as long as a post stayed on screen.
 *
 * Only likes on posts currently being watched are remembered, which keeps this
 * naturally small; `max` is a backstop for a long-lived tab.
 */
class SubjectIndex {
  private entries = new Map<string, string>();

  constructor(private max = 5000) {}

  private static key(did: string, collection: string, rkey: string) {
    return `${did}/${collection}/${rkey}`;
  }

  remember(did: string, collection: string, rkey: string, uri: string): void {
    const k = SubjectIndex.key(did, collection, rkey);
    this.entries.delete(k); // re-insert so iteration order is least-recent-first
    this.entries.set(k, uri);
    if (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  /** Look up and consume — a record can only be deleted once. */
  take(did: string, collection: string, rkey: string): string | undefined {
    const k = SubjectIndex.key(did, collection, rkey);
    const uri = this.entries.get(k);
    if (uri !== undefined) this.entries.delete(k);
    return uri;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

class JetstreamClient {
  private ws: WebSocket | null = null;
  /** Per-URI listeners: only the Post watching this URI gets notified */
  private uriListeners = new Map<string, Set<CountListener>>();
  /** Legacy broadcast listeners (for non-per-URI use cases) */
  private listeners = new Set<CountListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private reconnectAttempts = 0;
  private visibilityHandler: (() => void) | null = null;
  /** Maps like/repost records back to their subject so deletes can decrement. */
  private subjects = new SubjectIndex();

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

      this.ws.onopen = () => { this.reconnectAttempts = 0; };

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
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
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
    this.reconnectAttempts = 0;
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
    this.subjects.clear();
  }

  /** Subscribe to all count updates (broadcast — prefer per-URI watchPost listener) */
  subscribe(listener: CountListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handleEvent(data: any) {
    if (!data.commit) return;

    const { collection, operation, record, rkey } = data.commit;
    if (!collection || !operation) return;

    const type: 'like' | 'repost' | undefined =
      collection === 'app.bsky.feed.like' ? 'like'
      : collection === 'app.bsky.feed.repost' ? 'repost'
      : undefined;
    if (!type) return;

    let uri: string | undefined;
    let delta: 1 | -1;

    if (operation === 'create') {
      uri = record?.subject?.uri;
      if (!uri) return;
      // Remember it so the matching delete can be attributed later.
      if (data.did && rkey && this.uriListeners.has(uri)) {
        this.subjects.remember(data.did, collection, rkey, uri);
      }
      delta = 1;
    } else if (operation === 'delete') {
      // Deletes carry no subject; resolve it from the create we saw earlier.
      if (!data.did || !rkey) return;
      uri = this.subjects.take(data.did, collection, rkey);
      if (!uri) return;
      delta = -1;
    } else {
      return;
    }

    // Only emit for posts we're watching
    const perUri = this.uriListeners.get(uri);
    if (!perUri && this.listeners.size === 0) return;

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
