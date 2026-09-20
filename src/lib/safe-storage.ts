/**
 * Reading JSON out of localStorage without letting it take the app down.
 *
 * `JSON.parse(localStorage.getItem(k) ?? '[]')` throws a SyntaxError on
 * anything that is not valid JSON, and several of these ran at component
 * initialisation outside any try/catch. The worst was in +layout.svelte: a
 * single corrupt value there threw while the shell was initialising, so every
 * page failed to render, on every visit, with no way out but clearing site
 * data.
 *
 * Values get corrupted for dull reasons — a format that changed between
 * versions, a half-finished migration, another tool writing the same key,
 * someone editing it by hand. None of them are worth a white screen.
 *
 * The failure is recorded through swallow() rather than discarded, so a user
 * whose preference silently reset has something to show in the log viewer.
 */

import { swallow } from './debug-log';

/**
 * Parse a JSON value from localStorage, falling back when it is missing or
 * unreadable.
 *
 * @param validate optional shape check — a value of the wrong type is as
 *   unusable as one that does not parse, and it fails further away from here.
 */
export function readJson<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (e) {
    // Access itself throws where storage is disabled entirely.
    swallow(`safe-storage.read:${key}`, e);
    return fallback;
  }
  if (raw === null) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (validate && !validate(parsed)) {
      swallow(`safe-storage.shape:${key}`, new Error(`unexpected shape for ${key}`));
      return fallback;
    }
    return parsed as T;
  } catch (e) {
    swallow(`safe-storage.parse:${key}`, e);
    return fallback;
  }
}

/** Read a plain string, tolerating storage being unavailable. */
export function readString(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (e) {
    swallow(`safe-storage.read:${key}`, e);
    return fallback;
  }
}

/**
 * Write a JSON value. Returns false when it did not happen.
 *
 * setItem throws on a full quota, and throws on every call in Safari's
 * private mode. A caller that ignores the result reports a save that did not
 * occur — the same shape of lie as an unchecked fetch.
 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    swallow(`safe-storage.write:${key}`, e);
    return false;
  }
}

/** Write a plain string. Returns false when it did not happen. */
export function writeString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    swallow(`safe-storage.write:${key}`, e);
    return false;
  }
}

/** Remove a key, tolerating storage being unavailable. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    swallow(`safe-storage.remove:${key}`, e);
  }
}
