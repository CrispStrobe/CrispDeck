/**
 * Page-level error handling utilities.
 *
 * Provides consistent error reporting for page data loading. Use these
 * instead of a catch block that only reaches the console: a console-only
 * failure is invisible to the user, who is left looking at an empty list
 * with no idea whether it is empty or broken.
 *
 * Failures are filed through swallow() so they also reach the in-app log
 * viewer in Settings, where a user can actually read them.
 *
 * Pass `message` to show a translated string; the English fallback built
 * from `context` is only for internal operations with no UI copy yet.
 */

import { toast } from '$lib/toast.svelte';
import { swallow } from './debug-log';

/**
 * Wrap an async operation with error toast on failure.
 * Returns the result on success, or the fallback value on failure.
 *
 * Usage:
 *   const posts = await tryLoad(() => client.getTimeline(), [], 'Timeline');
 */
export async function tryLoad<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: string,
  message?: string,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    swallow(`tryLoad:${context ?? 'unknown'}`, e);
    toast.error(message ?? (context ? `Failed to load ${context}` : 'Loading failed'));
    return fallback;
  }
}

/**
 * Wrap an async action (like, follow, block) with error toast on failure.
 * Returns true on success, false on failure.
 *
 * Usage:
 *   const ok = await tryAction(() => client.like(uri, cid), 'like');
 */
export async function tryAction(
  fn: () => Promise<unknown>,
  actionName: string,
  message?: string,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    swallow(`tryAction:${actionName}`, e);
    toast.error(message ?? `${actionName} failed`);
    return false;
  }
}

/**
 * Wrap an async write operation with success + error toasts.
 *
 * Usage:
 *   await tryWrite(() => saveDraft(data), 'Draft saved', 'save draft');
 */
export async function tryWrite(
  fn: () => Promise<unknown>,
  successMsg: string,
  errorContext: string,
  message?: string,
): Promise<boolean> {
  try {
    await fn();
    toast.success(successMsg);
    return true;
  } catch (e) {
    swallow(`tryWrite:${errorContext}`, e);
    toast.error(message ?? `Failed to ${errorContext}`);
    return false;
  }
}
