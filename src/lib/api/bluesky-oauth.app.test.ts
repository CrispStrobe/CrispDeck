/** Native OAuth: interactive authorization and honest expired-session handling. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/platform', () => ({ isTauri: () => true }));
const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...args: unknown[]) => goto(...args) }));
vi.mock('$app/paths', () => ({ base: '' }));
const authorizeInWindow = vi.fn();
const authorizeInBrowser = vi.fn();
let mode: 'window' | 'browser' = 'window';
vi.mock('$lib/oauth-window', async (original) => ({
  ...(await original<typeof import('$lib/oauth-window')>()),
  getOAuthWindowMode: () => mode,
  authorizeInWindow: (...args: unknown[]) => authorizeInWindow(...args),
  authorizeInBrowser: (...args: unknown[]) => authorizeInBrowser(...args),
}));
let clientConfig: any;
const client = {
  authorize: vi.fn(), callback: vi.fn(), abortRequest: vi.fn(), restore: vi.fn(), init: vi.fn(),
};
vi.mock('@atproto/oauth-client-browser', () => ({
  TokenRefreshError: class extends Error {},
  TokenRevokedError: class extends Error {},
  TokenInvalidError: class extends Error {},
  BrowserOAuthClient: vi.fn().mockImplementation((config: any) => {
    clientConfig = config;
    return client;
  }),
}));
vi.mock('@atproto/api', () => ({ Agent: vi.fn().mockImplementation((session: any) => ({ session })) }));
import { getOAuthClient, startBlueskyOAuth, restoreBlueskyOAuthSession, initBlueskyOAuth } from './bluesky-oauth';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mode = 'window';
  client.authorize.mockResolvedValue(new URL('https://bsky.social/oauth/authorize?request_uri=r'));
  client.callback.mockResolvedValue({ session: { sub: 'did:plc:me', did: 'did:plc:me' } });
  client.abortRequest.mockResolvedValue(undefined);
  client.restore.mockResolvedValue({ sub: 'did:plc:me', did: 'did:plc:me' });
  authorizeInWindow.mockResolvedValue('code=c&state=s');
  authorizeInBrowser.mockResolvedValue('code=c&state=s');
});

it('uses the published native client and query callbacks', async () => {
  await getOAuthClient();
  expect(clientConfig.clientMetadata.client_id).toBe('https://crispdeck.vercel.app/client-metadata-native.json');
  expect(clientConfig.clientMetadata.redirect_uris).toEqual(['app.vercel.crispdeck:/oauth/callback']);
  expect(clientConfig.responseMode).toBe('query');
});

it('completes an interactive window sign-in and saves its session pointer', async () => {
  await startBlueskyOAuth(' alice.bsky.social ');
  expect(client.authorize).toHaveBeenCalledWith('alice.bsky.social', {
    redirect_uri: 'app.vercel.crispdeck:/oauth/callback',
  });
  expect(authorizeInWindow).toHaveBeenCalledTimes(1);
  expect(authorizeInBrowser).not.toHaveBeenCalled();
  expect(client.callback.mock.calls[0][0].toString()).toBe('code=c&state=s');
  expect(localStorage.getItem('@@atproto/oauth-client-browser(sub)')).toBe('did:plc:me');
  expect(goto).toHaveBeenCalledWith('/oauth/bsky-callback');
});

it('uses the browser when selected, and handles an empty handle', async () => {
  mode = 'browser';
  await startBlueskyOAuth('  ');
  expect(client.authorize.mock.calls[0][0]).toBe('https://bsky.social');
  expect(authorizeInWindow).not.toHaveBeenCalled();
  expect(authorizeInBrowser).toHaveBeenCalledTimes(1);
});

it('falls back to the browser only when the sign-in window cannot open', async () => {
  authorizeInWindow.mockRejectedValue(new Error('could not open the sign-in window: unsupported'));
  await startBlueskyOAuth('alice.bsky.social');
  expect(authorizeInBrowser).toHaveBeenCalledTimes(1);
});

it('aborts a cancelled authorization without reopening it in the browser', async () => {
  authorizeInWindow.mockRejectedValue(new Error('the sign-in window was closed'));
  await expect(startBlueskyOAuth('alice.bsky.social')).rejects.toThrow('was closed');
  expect(client.abortRequest).toHaveBeenCalledTimes(1);
  expect(authorizeInBrowser).not.toHaveBeenCalled();
  expect(goto).not.toHaveBeenCalled();
});

it.each(['TokenRefreshError', 'TokenRevokedError', 'TokenInvalidError'])('%s requires reconnection without starting another authorization', async (name) => {
  client.restore.mockRejectedValue(Object.assign(new Error('session ended'), { name }));
  await expect(restoreBlueskyOAuthSession('did:plc:me')).resolves.toEqual({ status: 'expired' });
  expect(client.authorize).not.toHaveBeenCalled();
  expect(authorizeInWindow).not.toHaveBeenCalled();
  expect(authorizeInBrowser).not.toHaveBeenCalled();
});

it('restores an existing native session without parsing the app URL as a web callback', async () => {
  localStorage.setItem('@@atproto/oauth-client-browser(sub)', 'did:plc:me');
  expect((await initBlueskyOAuth())?.did).toBe('did:plc:me');
  expect(client.restore).toHaveBeenCalledWith('did:plc:me');
  expect(client.init).not.toHaveBeenCalled();
});
