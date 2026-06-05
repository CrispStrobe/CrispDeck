/**
 * Bluesky Jetstream client — subscribes to real-time events
 * for live-updating like/repost counts on posts.
 *
 * Jetstream is a WebSocket firehose that streams AT Protocol events.
 * We filter for like and repost events on posts we're currently displaying.
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
  private listeners = new Set<CountListener>();
  private watchedUris = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;

  /** Start listening for real-time events */
  connect() {
    if (this.ws || !this.enabled) return;

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
  }

  /** Enable/disable the connection */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && !this.ws) {
      this.connect();
    } else if (!enabled) {
      this.disconnect();
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === 1; // WebSocket.OPEN = 1
  }

  /** Register a post URI to watch for count changes */
  watchPost(uri: string) {
    this.watchedUris.add(uri);
  }

  /** Stop watching a post URI */
  unwatchPost(uri: string) {
    this.watchedUris.delete(uri);
  }

  /** Clear all watched posts */
  clearWatched() {
    this.watchedUris.clear();
  }

  /** Subscribe to count updates */
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
    if (!this.watchedUris.has(uri)) return;

    const delta = operation === 'create' ? 1 : operation === 'delete' ? -1 : 0;
    if (delta === 0) return;

    const update: CountUpdate = { uri, type, delta: delta as 1 | -1 };
    for (const listener of this.listeners) {
      listener(update);
    }
  }
}

/** Singleton Jetstream client */
export const jetstream = new JetstreamClient();
