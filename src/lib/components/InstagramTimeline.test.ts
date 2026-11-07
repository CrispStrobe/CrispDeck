import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { i18n } from '$lib/i18n.svelte';

const mocks = vi.hoisted(() => ({
  supported: vi.fn(),
  create: vi.fn(),
  home: vi.fn(),
  reload: vi.fn(),
  destroy: vi.fn(),
  popout: vi.fn(),
  beforeNavigate: vi.fn(),
  external: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ beforeNavigate: mocks.beforeNavigate }));
vi.mock('$lib/external-link', () => ({ openExternalLink: mocks.external }));
vi.mock('$lib/instagram', () => ({
  INSTAGRAM_HOME_URL: 'https://www.instagram.com/',
  instagramSupported: mocks.supported,
  createInstagramTimeline: mocks.create,
  popoutInstagram: mocks.popout,
}));

import InstagramTimeline from './InstagramTimeline.svelte';

let instance: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.supported.mockResolvedValue(false);
  mocks.create.mockReturnValue({ home: mocks.home, reload: mocks.reload, destroy: mocks.destroy });
  mocks.home.mockResolvedValue(undefined);
  mocks.reload.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.popout.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined;
  document.body.innerHTML = '';
});

async function settle() {
  flushSync();
  await tick(); await tick(); await tick(); await tick();
  flushSync();
}

async function render() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  instance = mount(InstagramTimeline, { target });
  await settle();
  return target;
}

function button(target: ParentNode, text: string): HTMLButtonElement {
  const element = [...target.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === text);
  expect(element, `Expected button: ${text}`).toBeDefined();
  return element!;
}

describe('Instagram timeline view', () => {
  it('offers a real website link on web and mobile without a fake feed or iframe', async () => {
    const target = await render();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(target.textContent).toContain(i18n.t.instagram.externalHint);
    const link = target.querySelector<HTMLAnchorElement>('a')!;
    expect(link.href).toBe('https://www.instagram.com/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(target.querySelectorAll('iframe, input[type="password"], input[type="text"]')).toHaveLength(0);
    expect(target.textContent).toContain(i18n.t.instagram.sessionNote);
    expect(target.textContent).toContain(i18n.t.instagram.followingHint);
  });

  it('mounts an inline native viewport and wires its real navigation controls', async () => {
    mocks.supported.mockResolvedValue(true);
    const target = await render();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toBe(target.querySelector('[role="region"]'));
    expect(button(target, i18n.t.instagram.home).disabled).toBe(true);
    flushSync(() => mocks.create.mock.calls[0][1].onReady());
    expect(button(target, i18n.t.instagram.home).disabled).toBe(false);

    button(target, i18n.t.instagram.home).click(); await settle();
    button(target, i18n.t.instagram.reload).click(); await settle();
    button(target, i18n.t.instagram.popout).click(); await settle();
    expect(mocks.home).toHaveBeenCalledTimes(1);
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.popout).toHaveBeenCalledTimes(1);
    expect(target.querySelector('iframe')).toBeNull();
    expect(target.querySelectorAll('button')).toHaveLength(3);
  });

  it('shows the current approved origin and pauses its placeholder for app overlays', async () => {
    mocks.supported.mockResolvedValue(true);
    const target = await render();
    const callbacks = mocks.create.mock.calls[0][1];
    expect(target.querySelector(`[aria-label="${i18n.t.instagram.originLabel}"]`)?.textContent).toBe('https://www.instagram.com');
    flushSync(() => {
      callbacks.onReady();
      callbacks.onOriginChange('https://www.facebook.com');
      callbacks.onVisibilityChange(false);
    });
    expect(target.querySelector(`[aria-label="${i18n.t.instagram.originLabel}"]`)?.textContent).toBe('https://www.facebook.com');
    expect(target.textContent).toContain(i18n.t.instagram.hidden);
    flushSync(() => callbacks.onVisibilityChange(true));
    expect(target.textContent).not.toContain(i18n.t.instagram.hidden);
  });

  it('recovers from a native failure without exposing raw navigation errors', async () => {
    mocks.supported.mockResolvedValue(true);
    const target = await render();
    flushSync(() => mocks.create.mock.calls[0][1].onError(new Error('https://instagram.com/?code=secret')));
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(i18n.t.instagram.loadFailed);
    expect(target.textContent).not.toContain('secret');
    expect(target.querySelector('[role="alert"][data-native-webview-overlay]')).not.toBeNull();
    button(target, i18n.t.instagram.retry).click();
    await settle();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    flushSync(() => mocks.create.mock.calls[1][1].onReady());
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it('retains a browser fallback when native capability detection fails', async () => {
    mocks.supported.mockRejectedValueOnce(new Error('unknown native command'));
    const target = await render();
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(i18n.t.instagram.loadFailed);
    expect(target.querySelector<HTMLAnchorElement>('a')?.href).toBe('https://www.instagram.com/');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('uses the existing native external-link handler for browser fallback clicks', async () => {
    const target = await render();
    target.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(mocks.external).toHaveBeenCalledWith(expect.any(MouseEvent), 'https://www.instagram.com/', expect.any(Function));
    flushSync(() => mocks.external.mock.calls[0][2]());
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(i18n.t.instagram.browserFailed);
  });

  it('destroys the native viewport before a different route starts its transition', async () => {
    mocks.supported.mockResolvedValue(true);
    await render();
    const leave = mocks.beforeNavigate.mock.calls[0][0];
    leave({ from: { url: new URL('https://crispdeck.test/instagram') }, to: { url: new URL('https://crispdeck.test/instagram?view=home') } });
    expect(mocks.destroy).not.toHaveBeenCalled();
    leave({ from: { url: new URL('https://crispdeck.test/instagram') }, to: { url: new URL('https://crispdeck.test/deck') } });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not mount a late native viewport after the page has unmounted', async () => {
    let resolve: (available: boolean) => void = () => {};
    mocks.supported.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
    await render();
    expect(mocks.supported).toHaveBeenCalledTimes(1);
    await unmount(instance!); instance = undefined;
    resolve(true);
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('destroys the active viewport on unmount', async () => {
    mocks.supported.mockResolvedValue(true);
    await render();
    await unmount(instance!); instance = undefined;
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
