/**
 * Page-level error handling utilities.
 *
 * Provides consistent error reporting for page data loading.
 * Use instead of silent catch {} blocks on user-visible operations.
 */

import { toast } from '$lib/toast.svelte';

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
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = context ? `Failed to load ${context}` : 'Loading failed';
    console.error(msg, e);
    toast.error(msg);
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
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(`${actionName} failed:`, e);
    toast.error(`${actionName} failed`);
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
): Promise<boolean> {
  try {
    await fn();
    toast.success(successMsg);
    return true;
  } catch (e) {
    console.error(`Failed to ${errorContext}:`, e);
    toast.error(`Failed to ${errorContext}`);
    return false;
  }
}
