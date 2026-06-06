/**
 * Read position sync — remember where the user left off in each feed/column.
 * Stores the URI of the last-seen post per context key.
 */

const STORAGE_KEY = 'crispdeck-read-positions';

interface ReadPositions {
  [contextKey: string]: {
    lastSeenUri: string;
    lastSeenAt: string;
    scrollY?: number;
  };
}

function load(): ReadPositions {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function save(positions: ReadPositions): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
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
