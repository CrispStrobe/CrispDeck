import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isTauri: vi.fn(), invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), openUrl: vi.fn(),
}));
vi.mock('$lib/platform', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));

import {
  INSTAGRAM_HOME_URL, createInstagramTimeline, instagramBounds, instagramCapabilities,
  openInstagramBrowser, popoutInstagram, type InstagramTimelineHandle,
} from './instagram';

const handles: InstagramTimelineHandle[] = [];
let slot: HTMLElement;
let bounds: DOMRect;
let originListener: (event: { payload: { sessionId: string; origin: string } }) => void;

function mount(callbacks: Parameters<typeof createInstagramTimeline>[1] = {}) {
  const controller = createInstagramTimeline(slot, callbacks);
  handles.push(controller);
  return controller;
}

const calls = (command: string) => native.invoke.mock.calls.filter(call => call[0] === command);
async function shown() {
  await vi.waitFor(() => expect(calls('instagram_web_update').at(-1)?.[1].visible).toBe(true), { interval: 5 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  native.isTauri.mockReturnValue(true);
  native.invoke.mockImplementation(async (command) => command === 'instagram_web_supported' ? { inline: true, popout: true } : undefined);
  native.listen.mockImplementation(async (_event, handler) => {
    originListener = handler;
    return native.unlisten;
  });
  native.openUrl.mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  bounds = new DOMRect(200, 150, 600, 500);
  slot = document.createElement('div');
  slot.getBoundingClientRect = () => bounds;
  document.body.append(slot);
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.destroy()));
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('platform and external navigation', () => {
  it('never attempts native IPC from the web build', async () => {
    native.isTauri.mockReturnValue(false);
    await expect(instagramCapabilities()).resolves.toEqual({ inline: false, popout: false });
    expect(() => mount()).toThrow('desktop app');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('uses native capability detection and opens Instagram externally on mobile', async () => {
    native.invoke.mockResolvedValue({ inline: false, popout: false });
    await expect(instagramCapabilities()).resolves.toEqual({ inline: false, popout: false });
    await popoutInstagram();
    expect(native.openUrl).toHaveBeenCalledWith(INSTAGRAM_HOME_URL);
    expect(calls('instagram_web_popout')).toHaveLength(0);
  });

  it('offers a native window on Linux even when an inline view is unavailable', async () => {
    native.invoke.mockResolvedValue({ inline: false, popout: true });
    await expect(instagramCapabilities()).resolves.toEqual({ inline: false, popout: true });
    await popoutInstagram();
    expect(calls('instagram_web_popout')).toHaveLength(1);
    expect(calls('instagram_web_open')).toHaveLength(0);
    expect(native.openUrl).not.toHaveBeenCalled();
  });

  it('opens the fixed official URL through the OS or a browser popup', async () => {
    await openInstagramBrowser();
    expect(native.openUrl).toHaveBeenCalledWith('https://www.instagram.com/');
    native.isTauri.mockReturnValue(false);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const opening = openInstagramBrowser();
    expect(open).toHaveBeenCalledWith(INSTAGRAM_HOME_URL, '_blank', 'noopener,noreferrer');
    await opening;
  });
});

describe('native slot geometry', () => {
  const viewport = { width: 1200, height: 800 };

  it('rounds inward in logical pixels without multiplying for HiDPI screens', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(instagramBounds({ left: 200.2, top: 100.3, width: 600.6, height: 500.6 }, viewport))
      .toEqual({ x: 201, y: 101, width: 599, height: 499 });
  });

  it.each([
    { left: -20, top: 100, width: 600, height: 500 },
    { left: 1000, top: 100, width: 600, height: 500 },
    { left: 200, top: 500, width: 600, height: 500 },
    { left: 200, top: 100, width: 0, height: 500 },
    { left: 200, top: 100, width: 600, height: NaN },
  ])('hides a clipped, empty, or invalid slot (%j)', rect => {
    expect(instagramBounds(rect, viewport)).toBeNull();
  });

  it('respects an ancestor scroll container instead of painting over its edge', () => {
    expect(instagramBounds(bounds, viewport, [{ left: 200, top: 150, width: 500, height: 500 }])).toBeNull();
  });
});

describe('timeline lifecycle', () => {
  it('creates a hidden view, applies its slot, and controls only its own native session', async () => {
    const ready = vi.fn();
    const handle = mount({ onReady: ready });
    await shown();
    const args = calls('instagram_web_open')[0][1];
    expect(args).toEqual({ sessionId: expect.any(String), bounds: { x: 200, y: 150, width: 600, height: 500 } });
    expect(calls('instagram_web_open')).toHaveLength(1);
    expect(ready).toHaveBeenCalledOnce();
    await handle.home();
    await handle.reload();
    expect(calls('instagram_web_navigate')[0][1]).toEqual({ sessionId: args.sessionId });
    expect(calls('instagram_web_reload')[0][1]).toEqual({ sessionId: args.sessionId });
    await handle.destroy();
    await handle.destroy();
    expect(calls('instagram_web_close')).toEqual([['instagram_web_close', { sessionId: args.sessionId }]]);
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it('hides for an app dialog and restores the same session when it closes', async () => {
    const visibility = vi.fn();
    mount({ onVisibilityChange: visibility });
    await shown();
    const modal = document.createElement('div');
    modal.setAttribute('data-native-webview-overlay', '');
    modal.getBoundingClientRect = () => new DOMRect(300, 200, 100, 100);
    document.body.append(modal);
    await vi.waitFor(() => expect(calls('instagram_web_update').at(-1)?.[1].visible).toBe(false), { interval: 5 });
    modal.remove();
    await shown();
    expect(calls('instagram_web_open')).toHaveLength(1);
    expect(visibility.mock.calls.map(call => call[0])).toEqual([true, false, true]);
  });

  it('coalesces resize signals and hides a partially clipped native view', async () => {
    const handle = mount();
    await shown();
    bounds = new DOMRect(210, 150, 500, 450);
    for (let i = 0; i < 10; i++) handle.refreshLayout();
    await vi.waitFor(() => expect(calls('instagram_web_update').at(-1)?.[1].bounds?.width).toBe(500), { interval: 5 });
    expect(calls('instagram_web_update')).toHaveLength(2);
    bounds = new DOMRect(-10, 150, 500, 450);
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(calls('instagram_web_update').at(-1)?.[1].visible).toBe(false), { interval: 5 });
  });

  it('does not start a remote browser while an app overlay is already visible', async () => {
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.getBoundingClientRect = () => new DOMRect(200, 200, 200, 200);
    document.body.append(modal);
    const visibility = vi.fn();
    mount({ onVisibilityChange: visibility });
    await vi.waitFor(() => expect(visibility).toHaveBeenCalledWith(false), { interval: 5 });
    expect(calls('instagram_web_open')).toHaveLength(0);
    modal.remove();
    await shown();
  });

  it('remeasures after slow creation and never shows behind a newly opened dialog', async () => {
    const create = deferred<void>();
    native.invoke.mockImplementation(command => command === 'instagram_web_open' ? create.promise : Promise.resolve());
    mount();
    await vi.waitFor(() => expect(calls('instagram_web_open')).toHaveLength(1), { interval: 5 });
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.getBoundingClientRect = () => new DOMRect(200, 200, 200, 200);
    document.body.append(modal);
    create.resolve();
    await vi.waitFor(() => expect(calls('instagram_web_update')).toHaveLength(1), { interval: 5 });
    expect(calls('instagram_web_update')[0][1].visible).toBe(false);
  });

  it('closes a late-created view before a new route mount can claim its label', async () => {
    const create = deferred<void>();
    native.invoke.mockImplementationOnce(() => create.promise);
    const firstReady = vi.fn();
    const first = mount({ onReady: firstReady });
    await vi.waitFor(() => expect(calls('instagram_web_open')).toHaveLength(1), { interval: 5 });
    const firstId = calls('instagram_web_open')[0][1].sessionId;
    const closing = first.destroy();
    mount();
    create.resolve();
    await closing;
    await shown();
    const secondId = calls('instagram_web_open')[1][1].sessionId;
    expect(firstId).not.toBe(secondId);
    expect(firstReady).not.toHaveBeenCalled();
    expect(calls('instagram_web_update').every(call => call[1].sessionId === secondId)).toBe(true);
    const order = native.invoke.mock.calls.map(call => call[0]);
    expect(order.slice(0, 4)).toEqual(['instagram_web_open', 'instagram_web_close', 'instagram_web_open', 'instagram_web_update']);
  });

  it('cleans up a view after update failure and reports a recoverable error once', async () => {
    native.invoke.mockImplementation(command => command === 'instagram_web_update'
      ? Promise.reject(new Error('native update failed')) : Promise.resolve());
    const error = vi.fn();
    mount({ onError: error });
    await vi.waitFor(() => expect(calls('instagram_web_close')).toHaveLength(1), { interval: 5 });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0].message).toBe('native update failed');
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it('accepts only this mount’s origin-only notices, never an authentication URL', async () => {
    const origin = vi.fn();
    const handle = mount({ onOriginChange: origin });
    await shown();
    const sessionId = calls('instagram_web_open')[0][1].sessionId;
    originListener({ payload: { sessionId: 'old-route', origin: 'https://www.instagram.com' } });
    originListener({ payload: { sessionId, origin: 'https://www.facebook.com/login?code=secret' } });
    originListener({ payload: { sessionId, origin: 'https://www.facebook.com' } });
    expect(origin.mock.calls).toEqual([['https://www.facebook.com']]);
    await handle.destroy();
    originListener({ payload: { sessionId, origin: 'https://www.instagram.com' } });
    expect(origin).toHaveBeenCalledOnce();
  });
});
