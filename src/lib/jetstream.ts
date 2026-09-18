/**
 * Bluesky Jetstream client — subscribes to real-time events
 * for live-updating like/repost counts on posts.
 *
 * Jetstream is a WebSocket firehose that streams AT Protocol events. It can
 * filter by collection but not by subject, so we receive every like and repost
 * on the network and keep only those touching posts currently on screen. Two
 * things keep that affordable:
 *
 *   - the socket and the filtering run in a worker when one is available, so
 *     the main thread only wakes for events that actually matter;
 *   - listeners are indexed by post URI, so a matching event notifies the one
 *     post it concerns rather than every mounted Post component.
 */
import { matchRawEvent, SubjectIndex, type CountUpdate } from './jetstream-filter';

export type { CountUpdate };

type CountListener = (update: CountUpdate) => void;

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

class JetstreamClient {
  private ws: WebSocket | null = null;
  private worker: Worker | null = null;
  private workerUnavailable = false;
  /** Listeners interested in one specific post. */
  private byUri = new Map<string, Set<CountListener>>();
  /** Listeners registered through the untargeted subscribe() API. */
  private listeners = new Set<CountListener>();
  private watchedUris = new Set<string>();
  /** Maps like/repost records back to their subject so deletes can decrement. */
  private subjects = new SubjectIndex();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private workerConnected = false;

  private isWatched = (uri: string) => this.watchedUris.has(uri);

  /**
   * Try to move the socket off the main thread. Falls back silently when
   * workers aren't available (SSR, some Tauri webviews, the test runner).
   */
  private ensureWorker(): Worker | null {
    if (this.worker || this.workerUnavailable) return this.worker;
    if (typeof Worker === 'undefined') {
      this.workerUnavailable = true;
      return null;
    }
    try {
      const worker = new Worker(new URL('./jetstream.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg?.type === 'update') this.dispatch(msg.update as CountUpdate);
        else if (msg?.type === 'status') this.workerConnected = !!msg.connected;
      };
      worker.onerror = () => {
        // Fall back to the main thread for the rest of the session.
        this.workerUnavailable = true;
        this.worker = null;
        this.workerConnected = false;
        if (this.enabled) this.connect();
      };
      for (const uri of this.watchedUris) worker.postMessage({ type: 'watch', uri });
      this.worker = worker;
      return worker;
    } catch {
      this.workerUnavailable = true;
      return null;
    }
  }

  /** Start listening for real-time events */
  connect() {
    if (!this.enabled) return;

    const worker = this.ensureWorker();
    if (worker) {
      worker.postMessage({ type: 'setEnabled', enabled: true });
      return;
    }

    if (this.ws) return;
    try {
      const params = new URLSearchParams({
        wantedCollections: 'app.bsky.feed.like,app.bsky.feed.repost',
      });
      this.ws = new WebSocket(`${JETSTREAM_URL}?${params}`);

      this.ws.onmessage = (event) => {
        const update = matchRawEvent(event.data as string, this.isWatched, this.subjects);
        if (update) this.dispatch(update);
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
    if (this.worker) {
      this.worker.postMessage({ type: 'setEnabled', enabled: false });
      this.workerConnected = false;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Enable/disable the connection */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  isConnected(): boolean {
    if (this.worker) return this.workerConnected;
    return this.ws?.readyState === 1; // WebSocket.OPEN = 1
  }

  /** Register a post URI to watch for count changes */
  watchPost(uri: string) {
    this.watchedUris.add(uri);
    this.worker?.postMessage({ type: 'watch', uri });
  }

  /** Stop watching a post URI */
  unwatchPost(uri: string) {
    this.watchedUris.delete(uri);
    this.worker?.postMessage({ type: 'unwatch', uri });
  }

  /** Clear all watched posts */
  clearWatched() {
    this.watchedUris.clear();
    this.subjects.clear();
    this.worker?.postMessage({ type: 'clear' });
  }

  /**
   * Watch one post and receive only its updates.
   *
   * Preferred over subscribe(): a feed mounts hundreds of Post components, and
   * an untargeted listener means every one of them runs on every event.
   * Returns a single teardown that both unwatches and unsubscribes.
   */
  watch(uri: string, listener: CountListener): () => void {
    this.watchPost(uri);
    let set = this.byUri.get(uri);
    if (!set) {
      set = new Set();
      this.byUri.set(uri, set);
    }
    set.add(listener);

    return () => {
      const current = this.byUri.get(uri);
      if (current) {
        current.delete(listener);
        if (current.size === 0) {
          this.byUri.delete(uri);
          this.unwatchPost(uri);
        }
      } else {
        this.unwatchPost(uri);
      }
    };
  }

  /** Subscribe to all count updates. Prefer watch() for a single post. */
  subscribe(listener: CountListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Number of listeners that would run for an event on this uri (for tests). */
  listenerCountFor(uri: string): number {
    return (this.byUri.get(uri)?.size ?? 0) + this.listeners.size;
  }

  private dispatch(update: CountUpdate) {
    const targeted = this.byUri.get(update.uri);
    if (targeted) {
      for (const listener of targeted) listener(update);
    }
    for (const listener of this.listeners) listener(update);
  }

  /** Feed a raw message through the pipeline. Exposed for tests. */
  handleRawMessage(raw: string) {
    const update = matchRawEvent(raw, this.isWatched, this.subjects);
    if (update) this.dispatch(update);
  }
}

/** Singleton Jetstream client */
export const jetstream = new JetstreamClient();
