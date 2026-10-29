/**
 * Getting an OAuth redirect back into the app: the sign-in window, or the
 * system browser and a deep link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
const openUrl = vi.fn();
let deepLinkHandler: ((urls: string[]) => void) | null = null;
const unlisten = vi.fn();
const register = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: async (h: (urls: string[]) => void) => {
    deepLinkHandler = h;
    return register();
  },
}));

import {
  authorizeInBrowser,
  authorizeInWindow,
  getOAuthWindowMode,
  setOAuthWindowMode,
  queryOf,
  BLUESKY_APP_REDIRECT,
  MASTODON_APP_REDIRECT,
} from './oauth-window';

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  openUrl.mockReset();
  unlisten.mockReset();
  deepLinkHandler = null;
  register.mockReset().mockResolvedValue(unlisten);
});

afterEach(() => { vi.useRealTimers(); });

describe('return addresses', () => {
  it('Bluesky returns to what the published native metadata lists', async () => {
    const { readFileSync } = await import('node:fs');
    const meta = JSON.parse(readFileSync('static/client-metadata-native.json', 'utf8'));
    expect(meta.redirect_uris).toEqual([BLUESKY_APP_REDIRECT]);
    // AT Protocol: a native client's scheme is its client_id host reversed.
    const host = new URL(meta.client_id).hostname;
    expect(BLUESKY_APP_REDIRECT.split(':')[0]).toBe(host.split('.').reverse().join('.'));
    expect(meta.application_type).toBe('native');
  });

  it('neither service needs a port', () => {
    expect(BLUESKY_APP_REDIRECT).not.toMatch(/127\.0\.0\.1|localhost/);
    expect(MASTODON_APP_REDIRECT).not.toMatch(/127\.0\.0\.1|localhost/);
  });
});

describe('queryOf', () => {
  it('takes the query of a custom-scheme URL and drops any fragment', () => {
    expect(queryOf('app.vercel.crispdeck:/oauth/callback?code=a&state=b#x')).toBe('code=a&state=b');
    expect(queryOf('app.vercel.crispdeck://oauth/mastodon?code=a')).toBe('code=a');
    expect(queryOf('app.vercel.crispdeck:/oauth/callback')).toBe('');
  });
});

describe('getOAuthWindowMode', () => {
  it('defaults to the sign-in window on desktop and remembers the browser choice', () => {
    expect(getOAuthWindowMode()).toBe('window');
    setOAuthWindowMode('browser');
    expect(getOAuthWindowMode()).toBe('browser');
  });

  it('is always the browser on a phone', () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)');
    expect(getOAuthWindowMode()).toBe('browser');
    ua.mockRestore();
  });
});

describe('authorizeInWindow', () => {
  it('asks Rust for a visible window with the long timeout', async () => {
    invoke.mockResolvedValue('code=a');
    await expect(authorizeInWindow('https://bsky.social/x', BLUESKY_APP_REDIRECT)).resolves.toBe('code=a');
    expect(invoke).toHaveBeenCalledWith('auth_in_app_window', {
      authUrl: 'https://bsky.social/x',
      redirectPrefix: BLUESKY_APP_REDIRECT,
      timeoutSecs: 300,
    });
  });


});

describe('authorizeInBrowser', () => {
  it('listens before opening the browser, and takes only its own redirect', async () => {
    openUrl.mockImplementation(async () => {
      // The listener must already be there when the browser opens.
      expect(deepLinkHandler).not.toBeNull();
      queueMicrotask(() => {
        deepLinkHandler!(['app.vercel.crispdeck://oauth/mastodon?code=other']);
        deepLinkHandler!([`${BLUESKY_APP_REDIRECT}-wrong?code=wrong`]);
        deepLinkHandler!([`${BLUESKY_APP_REDIRECT}?code=mine&state=s`]);
      });
    });

    const query = await authorizeInBrowser('https://bsky.social/x', BLUESKY_APP_REDIRECT);

    expect(query).toBe('code=mine&state=s');
    expect(openUrl).toHaveBeenCalledWith('https://bsky.social/x');
    expect(unlisten).toHaveBeenCalled();
  });

  it('stops listening when the browser cannot be opened', async () => {
    openUrl.mockRejectedValue(new Error('no browser'));
    await expect(authorizeInBrowser('https://x.example', BLUESKY_APP_REDIRECT)).rejects.toThrow('no browser');
    expect(unlisten).toHaveBeenCalled();
  });
});


describe('asynchronous listener registration', () => {
  it('does not open the browser before native registration completes', async () => {
    let ready!: (stop: () => void) => void;
    register.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    const result = authorizeInBrowser('https://bsky.social/x', BLUESKY_APP_REDIRECT);
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
    expect(openUrl).not.toHaveBeenCalled();
    ready(unlisten);
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalled());
    deepLinkHandler!([`${BLUESKY_APP_REDIRECT}?code=c`]);
    await expect(result).resolves.toBe('code=c');
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('does not open the browser if registration fails', async () => {
    register.mockRejectedValue(new Error('native listener unavailable'));
    await expect(authorizeInBrowser('https://bsky.social/x', BLUESKY_APP_REDIRECT)).rejects.toThrow('listener unavailable');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('cleans up a registration that completes after timeout', async () => {
    vi.useFakeTimers();
    let ready!: (stop: () => void) => void;
    register.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    const result = authorizeInBrowser('https://bsky.social/x', BLUESKY_APP_REDIRECT);
    const check = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(300001);
    await check;
    ready(unlisten);
    await vi.advanceTimersByTimeAsync(0);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
