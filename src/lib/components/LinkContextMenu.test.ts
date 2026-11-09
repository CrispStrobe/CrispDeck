import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { createClassComponent } from 'svelte/legacy';

const mocks = vi.hoisted(() => ({
  native: true, connected: vi.fn(), save: vi.fn(), goto: vi.fn(), open: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, dismissToast: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.native }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.open }));
vi.mock('$app/paths', () => ({ base: '/CrispDeck' }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/wallabag', () => ({ wallabagConnected: mocks.connected, saveToWallabag: mocks.save }));
vi.mock('$lib/toast.svelte', () => ({ toast: mocks.toast, dismissToast: mocks.dismissToast }));
vi.mock('$lib/i18n.svelte', () => ({ i18n: { t: {
  post: { openLinkFailed: 'Open failed' },
  settings: { wallabagConnectFirst: 'Wallabag zuerst verbinden' },
  linkMenu: { title: 'Link actions', open: 'Open link', copy: 'Copy link', share: 'Share link',
    copied: 'Copied', copyFailed: 'Copy failed', saveWallabag: 'Save to Wallabag', setupWallabag: 'Set up Wallabag',
    wallabagSaving: 'Saving to Wallabag…', wallabagSaved: 'Saved to Wallabag', wallabagFailed: 'Save failed', systemMenuHint: 'Shift-right-click for system menu' },
} } }));
import LinkContextMenu from './LinkContextMenu.svelte';

let app: ReturnType<typeof createClassComponent> | undefined;
const server = 'https://wallabag.example';
const article = 'https://article.example/read?a=1&b=2';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.native = true;
  mocks.connected.mockResolvedValue(false);
  mocks.save.mockResolvedValue(undefined);
  mocks.toast.info.mockReturnValue(42);
  mocks.goto.mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => {
  app?.$destroy(); app = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
async function render() {
  const target = document.createElement('main'); document.body.append(target);
  app = createClassComponent({ component: LinkContextMenu, target });
  flushSync(); await tick();
}
function rightClick(url = article, shiftKey = false) {
  const anchor = document.createElement('a'); anchor.href = url; document.body.append(anchor);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30, shiftKey });
  anchor.dispatchEvent(event); flushSync();
  return event;
}
function button(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === label);
}
async function menuButton(label: string) {
  await vi.waitFor(() => { flushSync(); expect(button(label)).toBeDefined(); });
  return button(label)!;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('native link context menu', () => {
  it('sends a configured but disconnected account to setup under the application base path', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    await render(); rightClick();
    (await menuButton('Set up Wallabag')).click();
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/CrispDeck/settings?tab=appearance#wallabag-url'));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('saves directly only when the selected server has credentials', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    await render(); rightClick();
    (await menuButton('Save to Wallabag')).click();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(server, article));
    expect(mocks.toast.success).toHaveBeenCalledWith('Saved to Wallabag');
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('checks again for a disconnect between opening the menu and clicking Save', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    await render(); rightClick();
    const save = await menuButton('Save to Wallabag');
    mocks.connected.mockResolvedValue(false);
    save.click();
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledTimes(1));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('localizes a session that disappears before saving', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    mocks.save.mockRejectedValue(new Error('Connect Wallabag in Settings first'));
    await render(); rightClick();
    (await menuButton('Save to Wallabag')).click();
    await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Wallabag zuerst verbinden'));
  });

  it('routes unreadable sessions to setup instead of leaving a dead Save action', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockRejectedValue(new Error('Stored credentials unavailable'));
    await render(); rightClick();
    (await menuButton('Set up Wallabag')).click();
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledTimes(1));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps the original server and article while another context menu opens', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    await render(); rightClick();
    const save = await menuButton('Save to Wallabag');
    const pending = deferred<boolean>();
    mocks.connected.mockReturnValueOnce(pending.promise);
    save.click();
    localStorage.setItem('crispdeck-wallabag-url', 'https://other-wallabag.example');
    rightClick('https://other-article.example/new');
    await menuButton('Save to Wallabag');
    pending.resolve(true);
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith(server, article));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale connection check relabel a newer menu', async () => {
    const pending = deferred<boolean>();
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockReturnValueOnce(pending.promise).mockResolvedValue(true);
    await render(); rightClick();
    await vi.waitFor(() => expect(mocks.connected).toHaveBeenCalledTimes(1));
    localStorage.setItem('crispdeck-wallabag-url', 'https://other-wallabag.example');
    rightClick('https://other-article.example/new');
    await menuButton('Save to Wallabag');
    pending.resolve(false);
    await tick(); flushSync();
    expect(button('Save to Wallabag')).toBeDefined();
  });

  it('still opens its menu when browser preferences are unavailable', async () => {
    vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await render();
    expect(rightClick().defaultPrevented).toBe(true);
    expect(await menuButton('Set up Wallabag')).toBeDefined();
    expect(mocks.connected).not.toHaveBeenCalled();
  });

  it('reports failed saves without a success notification', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    mocks.save.mockRejectedValueOnce(new Error('Wallabag refused the article'));
    await render(); rightClick();
    (await menuButton('Save to Wallabag')).click();
    await vi.waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Wallabag refused the article'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.dismissToast).toHaveBeenCalledWith(42);
  });

  it('shows progress until the save completes, then confirms success', async () => {
    localStorage.setItem('crispdeck-wallabag-url', server);
    mocks.connected.mockResolvedValue(true);
    const pending = deferred<void>();
    mocks.save.mockReturnValueOnce(pending.promise);
    await render(); rightClick();
    (await menuButton('Save to Wallabag')).click();
    await vi.waitFor(() => expect(mocks.toast.info).toHaveBeenCalledWith('Saving to Wallabag…', 0));
    expect(mocks.toast.success).not.toHaveBeenCalled();
    pending.resolve();
    await vi.waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Saved to Wallabag'));
    expect(mocks.dismissToast).toHaveBeenCalledWith(42);
  });

  it.each(['https://reader:private-test-secret@article.example', 'javascript:alert(1)'])('leaves credential-bearing or unsafe links out of the custom menu', async url => {
    await render();
    expect(rightClick(url).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('preserves internal routes and the explicit system-menu shortcut', async () => {
    await render();
    expect(rightClick(`${location.origin}/settings`).defaultPrevented).toBe(false);
    expect(rightClick(article, true).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps the browser context menu in a web build', async () => {
    mocks.native = false;
    await render();
    expect(rightClick().defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
