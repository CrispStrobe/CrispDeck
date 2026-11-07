import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn(), stored: '' }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('$lib/db', () => ({ getCredentialBackend: async () => ({ backend: 'keychain', macosKeychain: '/chosen/brickwright.keychain-db' }) }));
import { connectWallabag, saveToWallabag, disconnectWallabag } from './wallabag';

const credentials = { server: 'https://wallabag.example', clientId: 'client', clientSecret: 'secret', username: 'reader', password: 'password' };
const token = (access: string, refresh = 'refresh') => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: 3600 }), { status: 200 });
beforeEach(() => {
  vi.clearAllMocks(); mocks.stored = '';
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === 'wallabag_session_set') mocks.stored = args.value;
    if (command === 'wallabag_session_get') return mocks.stored || null;
    if (command === 'wallabag_session_delete') mocks.stored = '';
  });
});
describe('direct Wallabag API', () => {
  it('authenticates, stores tokens in the selected keychain, and saves without the password', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await connectWallabag(credentials);
    expect(mocks.stored).not.toContain('password');
    expect(mocks.invoke).toHaveBeenCalledWith('wallabag_session_set', expect.objectContaining({ backend: 'keychain', keychain: '/chosen/brickwright.keychain-db' }));
    await saveToWallabag(credentials.server, 'https://example.org/article');
    expect(mocks.fetch.mock.calls[1][0]).toBe('https://wallabag.example/api/entries.json');
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer access');
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ url: 'https://example.org/article' });
    await disconnectWallabag(); expect(mocks.stored).toBe('');
  });
  it('refreshes once after a 401 and retries the save', async () => {
    mocks.fetch.mockResolvedValueOnce(token('old')).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(token('new', 'new-refresh')).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await connectWallabag(credentials); await saveToWallabag(credentials.server, 'https://example.org/');
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh' });
    expect(mocks.fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer new');
    expect(JSON.parse(mocks.stored).refreshToken).toBe('new-refresh');
  });
  it('rejects insecure servers and reports failed saves', async () => {
    await expect(connectWallabag({ ...credentials, server: 'http://example.org' })).rejects.toThrow('HTTPS');
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(new Response('', { status: 500 }));
    await connectWallabag(credentials);
    await expect(saveToWallabag(credentials.server, 'https://example.org')).rejects.toThrow('(500)');
  });
});
