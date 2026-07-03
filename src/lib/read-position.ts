/**
 * Read position sync — remember where the user left off in each feed/column.
 * Stores the URI of the last-seen post per context key.
 *
 * Optimized: uses an in-memory cache with throttled localStorage writes
 * to avoid blocking the main thread on frequent scroll events.
 */

const STORAGE_KEY = 'crispdeck-read-positions';

interface ReadPositions {
  [contextKey: string]: {
    lastSeenUri: string;
    lastSeenAt: string;
    scrollY?: number;
  };
}

/** In-memory cache — avoids repeated JSON.parse on every read */
let _cache: ReadPositions | null = null;

function load(): ReadPositions {
  if (_cache) return _cache;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { _cache = {}; return _cache; }
  try { _cache = JSON.parse(raw); return _cache!; } catch { _cache = {}; return _cache; }
}

/** Throttle timer for batched localStorage writes */
let _saveTimer: ReturnType<typeof setTimeout> | undefined;

function save(positions: ReadPositions): void {
  _cache = positions;
  // Throttle writes: batch rapid scroll updates into one localStorage write
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  }, 500);
}

/**
 * Save the read position for a context (e.g., 'feed', 'deck-timeline', 'deck-mentions').
 */
export function saveReadPosition(contextKey: string, lastSeenUri: string, scrollY?: number): void {
  const positions = load();
  positions[contextKey] = {
    lastSeenUri,
    lastSeenAt: new Date().toISOString(),
    scrollY,
  };
  save(positions);
}

/**
 * Get the last-seen URI for a context.
 */
export function getReadPosition(contextKey: string): { lastSeenUri: string; lastSeenAt: string; scrollY?: number } | null {
  return load()[contextKey] ?? null;
}

/**
 * Find the index of the last-seen post in a list.
 * Returns -1 if not found.
 */
export function findReadPositionIndex(contextKey: string, postUris: string[]): number {
  const pos = getReadPosition(contextKey);
  if (!pos) return -1;
  return postUris.indexOf(pos.lastSeenUri);
}

/**
 * Clear read position for a context.
 */
export function clearReadPosition(contextKey: string): void {
  const positions = load();
  delete positions[contextKey];
  save(positions);
}

/** Flush pending writes immediately (call on page unload) */
export function flushReadPositions(): void {
  if (_cache && _saveTimer) {
    clearTimeout(_saveTimer);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
  }
}
