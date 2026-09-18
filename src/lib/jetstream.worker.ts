/**
 * Jetstream socket worker.
 *
 * Holds the firehose connection and does the filtering off the main thread, so
 * the UI only ever sees the few events that concern posts on screen.
 */
import { matchRawEvent, type CountUpdate } from './jetstream-filter';

const JETSTREAM_URL = 'wss://jetstream2.us-east.bsky.network/subscribe';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let enabled = false;
const watched = new Set<string>();

const isWatched = (uri: string) => watched.has(uri);

function post(msg: unknown) {
  (self as unknown as Worker).postMessage(msg);
}

function connect() {
  if (ws || !enabled) return;
  try {
    const params = new URLSearchParams({
      wantedCollections: 'app.bsky.feed.like,app.bsky.feed.repost',
    });
    ws = new WebSocket(`${JETSTREAM_URL}?${params}`);

    ws.onopen = () => post({ type: 'status', connected: true });

    ws.onmessage = (event: MessageEvent) => {
      const update = matchRawEvent(event.data as string, isWatched);
      if (update) post({ type: 'update', update });
    };

    ws.onclose = () => {
      ws = null;
      post({ type: 'status', connected: false });
      if (enabled) reconnectTimer = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws?.close();
  } catch {
    // WebSocket unavailable in this worker context
  }
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg?.type) {
    case 'watch': watched.add(msg.uri); break;
    case 'unwatch': watched.delete(msg.uri); break;
    case 'clear': watched.clear(); break;
    case 'setEnabled':
      enabled = msg.enabled;
      if (enabled) connect();
      else disconnect();
      break;
  }
};

export type { CountUpdate };
