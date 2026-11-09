/** The official website is the timeline. No Instagram credentials enter this module. */
import { isTauri } from '$lib/platform';

export const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';

export interface InstagramCapabilities {
  inline: boolean;
  popout: boolean;
}

export interface InstagramBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InstagramTimelineCallbacks {
  /** The native browser exists; this does not assert successful Instagram login. */
  onReady?: () => void;
  onError?: (error: unknown) => void;
  onVisibilityChange?: (visible: boolean) => void;
  /** Origin only, never the path/query of an authentication page. */
  onOriginChange?: (origin: string) => void;
}

export interface InstagramTimelineHandle {
  home(): Promise<void>;
  reload(): Promise<void>;
  destroy(): Promise<void>;
  refreshLayout(): void;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}

/** Runtime capability, rather than a mobile user-agent guess (iPad can look like Mac). */
export async function instagramCapabilities(): Promise<InstagramCapabilities> {
  if (!isTauri()) return { inline: false, popout: false };
  return invoke<InstagramCapabilities>('instagram_web_supported');
}

export async function openInstagramBrowser(): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(INSTAGRAM_HOME_URL);
  } else if (typeof window !== 'undefined') {
    // Run synchronously in the click task so a browser does not block the popup.
    window.open(INSTAGRAM_HOME_URL, '_blank', 'noopener,noreferrer');
  }
}

// Native operations from successive route mounts must not overtake each other.
// Rust additionally checks the per-mount session ID, including during teardown.
let nativeQueue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = nativeQueue.then(operation);
  nativeQueue = next.catch(() => undefined);
  return next;
}

export async function popoutInstagram(): Promise<void> {
  if (!(await instagramCapabilities()).popout) return openInstagramBrowser();
  await serial(() => invoke<void>('instagram_web_popout'));
}

/**
 * A native child is not CSS-clipped. Hide it if any edge would escape its DOM
 * slot, instead of allowing it to cover navigation, headers, or another page.
 * Coordinates are logical/CSS pixels, not multiplied by display pixel density.
 */
export function instagramBounds(
  rect: Rectangle,
  viewport: { width: number; height: number },
  clips: Rectangle[] = [],
): InstagramBounds | null {
  const numbers = [rect.left, rect.top, rect.width, rect.height, viewport.width, viewport.height];
  if (!numbers.every(Number.isFinite) || rect.width < 240 || rect.height < 160) return null;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const containers = [{ left: 0, top: 0, ...viewport }, ...clips];
  for (const clip of containers) {
    if (![clip.left, clip.top, clip.width, clip.height].every(Number.isFinite) ||
      rect.left < clip.left - 0.5 || rect.top < clip.top - 0.5 ||
      right > clip.left + clip.width + 0.5 || bottom > clip.top + clip.height + 0.5) return null;
  }
  const x = Math.max(0, Math.ceil(rect.left));
  const y = Math.max(0, Math.ceil(rect.top));
  return { x, y, width: Math.floor(right) - x, height: Math.floor(bottom) - y };
}

const OVERLAYS = '[data-native-webview-overlay], [aria-modal="true"], [role="dialog"], [role="menu"], dialog[open]';

function isVisible(element: Element): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
    style.opacity !== '0' && rect.width > 0 && rect.height > 0;
}

function measure(host: HTMLElement): InstagramBounds | null {
  if (!host.isConnected || document.visibilityState === 'hidden' || !isVisible(host)) return null;
  // Pinch zoom changes the relationship between CSS and native coordinates.
  // Keep controls usable and offer the browser instead of placing an unsafe view.
  const viewport = window.visualViewport;
  if (viewport && (Math.abs(viewport.scale - 1) > 0.001 || viewport.offsetLeft || viewport.offsetTop)) return null;
  for (const overlay of document.querySelectorAll(OVERLAYS)) {
    if (!host.contains(overlay) && isVisible(overlay)) return null;
  }

  const rect = host.getBoundingClientRect();
  const clips: Rectangle[] = [];
  for (let parent = host.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
    const bounds = parent.getBoundingClientRect();
    const clipX = /hidden|clip|auto|scroll/.test(style.overflowX || style.overflow);
    const clipY = /hidden|clip|auto|scroll/.test(style.overflowY || style.overflow);
    if (clipX || clipY) clips.push({
      left: clipX ? bounds.left : 0,
      top: clipY ? bounds.top : 0,
      width: clipX ? bounds.width : window.innerWidth,
      height: clipY ? bounds.height : window.innerHeight,
    });
  }
  const bounds = instagramBounds(rect, {
    width: Math.min(window.innerWidth, viewport?.width ?? window.innerWidth),
    height: Math.min(window.innerHeight, viewport?.height ?? window.innerHeight),
  }, clips);
  if (!bounds) return null;

  // Covers unmarked popovers as well. The native view itself is not in the DOM;
  // when unobstructed these points resolve to the placeholder or its children.
  if (typeof document.elementFromPoint === 'function') {
    const points = [
      [bounds.x + 2, bounds.y + 2],
      [bounds.x + bounds.width - 2, bounds.y + 2],
      [bounds.x + 2, bounds.y + bounds.height - 2],
      [bounds.x + bounds.width - 2, bounds.y + bounds.height - 2],
      [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
    ];
    if (points.some(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return !top || !host.contains(top);
    })) return null;
  }
  return bounds;
}

/** Mount exactly one browser surface; ownership is never inferred from account data. */
export function createInstagramTimeline(
  host: HTMLElement,
  callbacks: InstagramTimelineCallbacks = {},
): InstagramTimelineHandle {
  if (!isTauri()) throw new Error('The in-app Instagram timeline requires the desktop app.');
  const sessionId = crypto.randomUUID();
  let disposed = false;
  let failed = false;
  let opened = false;
  let ready = false;
  let visible: boolean | undefined;
  let applied = '';
  let dirty = false;
  let flushing = false;
  let frame: number | undefined;
  let closing: Promise<void> | undefined;
  let unlisten: (() => void) | undefined;
  let listening = false;

  function reportVisibility(value: boolean) {
    if (!disposed && visible !== value) {
      visible = value;
      callbacks.onVisibilityChange?.(value);
    }
  }

  async function listenForOrigin() {
    if (listening) return;
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen<{ sessionId: string; origin: string }>('instagram-web-origin', (event) => {
      if (disposed || event.payload?.sessionId !== sessionId) return;
      // The native layer sends origin only. Never forward an unexpected auth URL
      // into DOM, application logs, or storage even if an event is malformed.
      const origin = event.payload.origin;
      if (typeof origin === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(origin)) {
        callbacks.onOriginChange?.(origin);
      }
    });
    listening = true;
    if (disposed) stop(); else unlisten = stop;
  }

  async function applyLayout() {
    if (disposed || failed) return;
    let bounds = measure(host);
    if (!opened) {
      if (!bounds) { reportVisibility(false); return; }
      await listenForOrigin();
      if (disposed) return;
      // Creation is hidden on the native side. Re-measure after it completes:
      // the user can open a dialog or leave this route during the native await.
      await invoke<void>('instagram_web_open', { sessionId, bounds });
      opened = true;
    }
    if (disposed) return;
    bounds = measure(host);
    const state = JSON.stringify(bounds);
    if (state !== applied) {
      await invoke<void>('instagram_web_update', {
        sessionId, visible: !!bounds, ...(bounds ? { bounds } : {}),
      });
      applied = state;
    }
    if (disposed) return;
    reportVisibility(!!bounds);
    if (!ready) { ready = true; callbacks.onReady?.(); }
  }

  async function flush() {
    if (flushing || disposed || failed) return;
    flushing = true;
    dirty = false;
    try {
      await serial(applyLayout);
    } catch (error) {
      if (!disposed) {
        failed = true;
        reportVisibility(false);
        callbacks.onError?.(error);
        // An update can fail after creation. Do not leave the remote surface
        // over the error/fallback controls when that happens.
        void destroy().catch(() => undefined);
      }
    } finally {
      flushing = false;
      if (dirty) schedule();
    }
  }

  function schedule() {
    if (disposed || failed) return;
    dirty = true;
    if (flushing || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; void flush(); });
  }

  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  for (let element: HTMLElement | null = host; element; element = element.parentElement) resize?.observe(element);
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-modal', 'data-native-webview-overlay'],
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('transitionend', schedule, true);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);

  function destroy(): Promise<void> {
    if (closing) return closing;
    disposed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    resize?.disconnect();
    mutation.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('transitionend', schedule, true);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    unlisten?.();
    unlisten = undefined;
    closing = serial(() => invoke<void>('instagram_web_close', { sessionId }));
    return closing;
  }

  async function command(name: 'instagram_web_navigate' | 'instagram_web_reload') {
    await serial(async () => {
      if (disposed || !opened) return;
      await invoke<void>(name, { sessionId });
    });
    schedule();
  }

  schedule();
  return {
    home: () => command('instagram_web_navigate'),
    reload: () => command('instagram_web_reload'),
    destroy,
    refreshLayout: schedule,
  };
}
