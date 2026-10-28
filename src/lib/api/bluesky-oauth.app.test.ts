/**
 * Bluesky OAuth inside the app: the native client, sign-in, and automatic
 * re-login in a hidden window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/platform', () => ({ isTauri: () => true }));

const authorizeInWindow = vi.fn();
const authorizeInBrowser = vi.fn();
vi.mock('$lib/oauth-window', async (orig) => ({
  ...(await orig<typeof import('$lib/oauth-window')>()),
  getOAuthWindowMode: () => mode,
  authorizeInWindow: (...a: unknown[]) => authorizeInWindow(...a),
  authorizeInBrowser: (...a: unknown[]) => authorizeInBrowser(...a),
}));
let mode: 'window' | 'browser' = 'window';

let clientConfig: any;
const client = {
  authorize: vi.fn(async () => new URL('https://bsky.social/oauth/authorize?request_uri=r')),
  callback: vi.fn(async () => ({ session: { sub: 'did:plc:me', did: 'did:plc:me' } })),
  abortRequest: vi.fn(async () => {}),
};
vi.mock('@atproto/oauth-client-browser', () => ({
  BrowserOAuthClient: vi.fn().mockImplementation((config: any) => {
    clientConfig = config;
    return client;
  }),
}));
vi.mock('@atproto/api', () => ({ Agent: vi.fn().mockImplementation((s: any) => ({ session: s })) }));

import { silentReauthInApp, getOAuthClient, SESSION_RENEWED_EVENT } from './bluesky-oauth';

beforeEach(() => {
  localStorage.clear();
  mode = 'window';
  authorizeInWindow.mockReset();
  authorizeInBrowser.mockReset();
  client.authorize.mockClear();
  client.callback.mockClear();
});

describe('the app client', () => {
  it('is the published native client, returning to the app scheme', async () => {
    await getOAuthClient();
    expect(clientConfig.clientMetadata.client_id).toBe(
      'https://crispdeck.vercel.app/client-metadata-native.json',
    );
    expect(clientConfig.clientMetadata.redirect_uris).toEqual(['app.vercel.crispdeck:/oauth/callback']);
    expect(clientConfig.responseMode).toBe('query');
  });
});

describe('silentReauthInApp', () => {
  it('renews in a hidden window with prompt=none', async () => {
    authorizeInWindow.mockResolvedValue('code=c&state=s');

    const agent = await silentReauthInApp('did:plc:me', 'did:plc:me');

    expect(agent).not.toBeNull();
    expect(client.authorize).toHaveBeenCalledWith('did:plc:me', expect.objectContaining({ prompt: 'none' }));
    expect(authorizeInWindow.mock.calls[0][2]).toEqual({ hidden: true });
    expect(localStorage.getItem('@@atproto/oauth-client-browser(sub)')).toBe('did:plc:me');
  });

  it('shares one attempt between callers asking at the same time', async () => {
    authorizeInWindow.mockResolvedValue('code=c&state=s');

    const [a, b] = await Promise.all([
      silentReauthInApp('did:plc:me', 'did:plc:me'),
      silentReauthInApp('me.bsky.social', 'did:plc:me'),
    ]);

    expect(a).toBe(b);
    expect(a).not.toBeNull();
    expect(authorizeInWindow).toHaveBeenCalledTimes(1);
  });

  it('tries at most once per half hour', async () => {
    authorizeInWindow.mockRejectedValue(new Error('login_required'));

    expect(await silentReauthInApp('did:plc:me', 'did:plc:me')).toBeNull();
    expect(await silentReauthInApp('did:plc:me', 'did:plc:me')).toBeNull();
    expect(authorizeInWindow).toHaveBeenCalledTimes(1);
  });

  it('never opens the browser for a silent attempt', async () => {
    mode = 'browser';
    expect(await silentReauthInApp('did:plc:me', 'did:plc:me')).toBeNull();
    expect(authorizeInBrowser).not.toHaveBeenCalled();
    expect(authorizeInWindow).not.toHaveBeenCalled();
  });

  it('refuses a session for a different account', async () => {
    authorizeInWindow.mockResolvedValue('code=c&state=s');
    expect(await silentReauthInApp('did:plc:other', 'did:plc:other')).toBeNull();
  });
});

describe('a session that dies mid-use', () => {
  async function die(cause: Error) {
    await getOAuthClient();
    const renewed = vi.fn();
    window.addEventListener(SESSION_RENEWED_EVENT, renewed);
    clientConfig.onDelete('did:plc:me', cause);
    // onDelete starts the renewal without awaiting it; let it run.
    await new Promise((r) => setTimeout(r, 10));
    window.removeEventListener(SESSION_RENEWED_EVENT, renewed);
    return renewed;
  }

  it('is renewed in the background when its refresh failed', async () => {
    authorizeInWindow.mockResolvedValue('code=c&state=s');
    const cause = Object.assign(new Error('refresh failed'), { name: 'TokenRefreshError' });

    const renewed = await die(cause);

    expect(authorizeInWindow).toHaveBeenCalledTimes(1);
    expect(renewed).toHaveBeenCalledTimes(1);
  });

  it('is left alone when it was revoked', async () => {
    const cause = Object.assign(new Error('revoked'), { name: 'TokenRevokedError' });

    await die(cause);

    expect(authorizeInWindow).not.toHaveBeenCalled();
  });
});
