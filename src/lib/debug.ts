/**
 * Debug-gated logging for errors that are deliberately non-fatal.
 *
 * A lot of the app's work is per-account or per-column and partial failure is
 * normal: one instance is down, one token expired, one column 404s. Those were
 * caught and discarded entirely, which is right for the UI but leaves nothing
 * to look at when something is wrong.
 *
 * swallow() keeps the behaviour and makes the failure visible on request.
 * Enable with localStorage.setItem('crispdeck-debug', 'true'), or it is on
 * automatically in a dev build.
 */
let enabled: boolean | null = null;

function debugEnabled(): boolean {
  if (enabled !== null) return enabled;
  try {
    enabled = import.meta.env?.DEV === true ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('crispdeck-debug') === 'true');
  } catch {
    enabled = false; // storage blocked
  }
  return enabled;
}

/** Re-read the flag, for the settings toggle. */
export function resetDebugFlag(): void {
  enabled = null;
}

/**
 * Record a non-fatal error. Never throws — a logging failure must not become
 * the thing that breaks the caller.
 */
export function swallow(context: string, error: unknown): void {
  if (!debugEnabled()) return;
  try {
    console.warn(`[crispdeck] ${context}:`, error);
  } catch {
    // console unavailable; nothing useful left to do
  }
}
