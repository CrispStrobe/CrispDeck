import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true, backend: 'keychain', keychain: '/chosen/brickwright.keychain-db',
  invoke: vi.fn(), getBackend: vi.fn(), fetch: vi.fn(), browserFetch: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), stored: '',
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.native, invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('$lib/db', () => ({ getCredentialBackend: mocks.getBackend }));
vi.mock('$lib/browser-db', () => ({ encrypt: mocks.encrypt, decrypt: mocks.decrypt }));
let api: typeof import('./wallabag');

const credentials = { server: 'https://wallabag.example', clientId: 'client', clientSecret: 'secret', username: 'reader', password: 'password' };
const sessionKey = 'crispdeck-wallabag-session';
const searchScopeKey = 'crispdeck-wallabag-search-scope';
const token = (access: string, refresh = 'refresh', expires = 3600) => new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expires }), { status: 200 });
const saved = () => new Response('{}', { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.native = true;
  mocks.backend = 'keychain';
  mocks.keychain = '/chosen/brickwright.keychain-db';
  mocks.stored = '';
  mocks.getBackend.mockImplementation(async () => ({ backend: mocks.backend, macosKeychain: mocks.keychain }));
  localStorage.clear();
  mocks.encrypt.mockImplementation(async value => btoa(value));
  mocks.decrypt.mockImplementation(async value => atob(value));
  mocks.invoke.mockImplementation(async (command, args) => {
    if (args.backend !== mocks.backend || args.keychain !== mocks.keychain) throw new Error('Credential storage changed');
    if (command === 'wallabag_session_set') mocks.stored = args.value;
    if (command === 'wallabag_session_get') return mocks.stored || null;
    if (command === 'wallabag_session_delete') mocks.stored = '';
  });
  vi.stubGlobal('fetch', mocks.browserFetch);
  api = await import('./wallabag');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('direct Wallabag API', () => {
  it('authenticates, stores tokens in the selected keychain, and saves without the password', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(saved());
    await api.connectWallabag(credentials);
    expect(mocks.stored).not.toContain('password');
    expect(mocks.invoke).toHaveBeenCalledWith('wallabag_session_set', expect.objectContaining({ backend: 'keychain', keychain: '/chosen/brickwright.keychain-db' }));
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', maxRedirections: 0 });
    await api.saveToWallabag(credentials.server, 'https://example.org/article');
    expect(mocks.fetch.mock.calls[1][0]).toBe('https://wallabag.example/api/entries.json');
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer access');
    expect(mocks.fetch.mock.calls[1][1].maxRedirections).toBe(0);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ url: 'https://example.org/article' });
    await api.disconnectWallabag();
    expect(mocks.stored).toBe('');
  });

  it('preserves installations under a path and normalizes the returned server preference', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(saved());
    expect(await api.connectWallabag({ ...credentials, server: ' HTTPS://wallabag.example:443/reader/// ' })).toBe('https://wallabag.example/reader');
    await api.saveToWallabag('https://wallabag.example/reader/', 'https://example.org/article');
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(['https://wallabag.example/reader/oauth/v2/token', 'https://wallabag.example/reader/api/entries.json']);
  });

  it('refreshes once after a 401 and retries the save', async () => {
    mocks.fetch.mockResolvedValueOnce(token('old')).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(token('new', 'new-refresh')).mockResolvedValueOnce(saved());
    await api.connectWallabag(credentials);
    await api.saveToWallabag(credentials.server, 'https://example.org/');
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh' });
    expect(mocks.fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer new');
    expect(JSON.parse(mocks.stored).refreshToken).toBe('new-refresh');
  });

  it('rejects insecure servers and reports failed saves', async () => {
    await expect(api.connectWallabag({ ...credentials, server: 'http://example.org' })).rejects.toThrow('HTTPS');
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(new Response('', { status: 500 }));
    await api.connectWallabag(credentials);
    await expect(api.saveToWallabag(credentials.server, 'https://example.org')).rejects.toThrow('(500)');
  });

  it('does not accept an OAuth redirect as successful authentication', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: 'https://other.example/token' } }));
    await expect(api.connectWallabag(credentials)).rejects.toThrow('(307)');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][1].maxRedirections).toBe(0);
    expect(mocks.invoke).not.toHaveBeenCalledWith('wallabag_session_set', expect.anything());
  });

  it('does not use a saved token with a different configured server', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access'));
    await api.connectWallabag(credentials);
    await expect(api.saveToWallabag('https://other.example', 'https://example.org')).rejects.toThrow('Connect Wallabag');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['javascript:alert(1)', 'https://reader:secret@example.org/article', 'not a URL'])('rejects an unsafe article URL: %s', async link => {
    await expect(api.saveToWallabag(credentials.server, link)).rejects.toThrow('Invalid article URL');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('Wallabag token and saved-session validation', () => {
  it.each([
    null, [], {},
    { access_token: { token: 'access' }, refresh_token: 'refresh', expires_in: 3600 },
    { access_token: 'access\r\ninjected: value', refresh_token: 'refresh', expires_in: 3600 },
    { access_token: 'access', refresh_token: 12, expires_in: 3600 },
    { access_token: 'access', refresh_token: 'refresh', expires_in: null },
    { access_token: 'access', refresh_token: 'refresh', expires_in: true },
    { access_token: 'access', refresh_token: 'refresh', expires_in: 0 },
    { access_token: 'access', refresh_token: 'refresh', expires_in: -1 },
    { access_token: 'access', refresh_token: 'refresh', expires_in: 1e100 },
    { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'mac' },
  ])('rejects malformed OAuth response %# before persistence', async value => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)));
    await expect(api.connectWallabag(credentials)).rejects.toThrow('invalid token');
    expect(mocks.stored).toBe('');
  });

  it('accepts an integer lifetime represented as a string', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: '3600', token_type: 'Bearer' })));
    await api.connectWallabag(credentials);
    expect(JSON.parse(mocks.stored).expiresAt).toBeGreaterThan(Date.now());
  });

  it('limits the token response before parsing it', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, padding: 'x'.repeat(64 * 1024) })));
    await expect(api.connectWallabag(credentials)).rejects.toThrow('invalid token');
    expect(mocks.stored).toBe('');
  });

  it('does not expose response contents through JSON errors', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"access_token":"private-test-sentinel"'));
    await expect(api.connectWallabag(credentials)).rejects.toThrow('invalid token');
  });

  it.each(['null', '[]', '{"server":"https://wallabag.example","accessToken":"private-test-sentinel"}', '{"accessToken":"private-test-sentinel"'])('rejects malformed saved credentials %# before making a request', async raw => {
    mocks.stored = raw;
    const error = await api.saveToWallabag(credentials.server, 'https://example.org').catch(error => error);
    expect(error.message).toContain('Saved Wallabag credentials are invalid');
    expect(error.message).not.toContain('private-test-sentinel');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('keeps old valid sessions usable without a connection ID', async () => {
    mocks.stored = JSON.stringify({ server: credentials.server, clientId: 'client', clientSecret: 'secret', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000 });
    mocks.fetch.mockResolvedValueOnce(saved());
    await api.saveToWallabag(credentials.server, 'https://example.org/article');
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
  });

  it('bounds authentication time and leaves no saved session after a timeout', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted transport')));
    }));
    const result = expect(api.connectWallabag(credentials)).rejects.toThrow('timed out');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(mocks.stored).toBe('');
  });
});

describe('Wallabag account and refresh lifecycle', () => {
  it('does not start a superseded login after a delayed backend lookup', async () => {
    const pending = deferred<{ backend: string; macosKeychain: string }>();
    mocks.getBackend.mockReturnValueOnce(pending.promise);
    const login = api.connectWallabag(credentials).catch(error => error);
    await vi.waitFor(() => expect(mocks.getBackend).toHaveBeenCalledTimes(1));
    const disconnect = api.disconnectWallabag();
    pending.resolve({ backend: mocks.backend, macosKeychain: mocks.keychain });
    expect((await login).message).toContain('connection changed');
    await disconnect;
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.stored).toBe('');
  });

  it('does not restore a session when a delayed login completes after disconnect', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const login = api.connectWallabag(credentials).catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const disconnect = api.disconnectWallabag();
    pending.resolve(token('old-login'));
    expect((await login).message).toContain('connection changed');
    await disconnect;
    expect(mocks.stored).toBe('');
  });

  it('does not restore credentials or save a link after a refresh is disconnected', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockResolvedValueOnce(token('old', 'refresh', 1)).mockReturnValueOnce(pending.promise);
    await api.connectWallabag(credentials);
    const save = api.saveToWallabag(credentials.server, 'https://example.org/article').catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    const disconnect = api.disconnectWallabag();
    pending.resolve(token('late-refresh'));
    expect((await save).message).toContain('connection changed');
    await disconnect;
    expect(mocks.stored).toBe('');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let an old refresh overwrite a newer account on the same server', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockResolvedValueOnce(token('first-account', 'refresh', 1)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(token('second-account')).mockResolvedValueOnce(saved());
    await api.connectWallabag(credentials);
    const oldSave = api.saveToWallabag(credentials.server, 'https://example.org/old').catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    const newLogin = api.connectWallabag({ ...credentials, username: 'another-reader' });
    pending.resolve(token('old-account-refreshed'));
    expect((await oldSave).message).toContain('connection changed');
    await newLogin;
    await api.saveToWallabag(credentials.server, 'https://example.org/new');
    expect(JSON.parse(mocks.stored).accessToken).toBe('second-account');
    expect(mocks.fetch.mock.calls[3][1].headers.Authorization).toBe('Bearer second-account');
  });

  it('keeps the selected credential backend bound across authentication', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const login = api.connectWallabag(credentials).catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.backend = 'local';
    pending.resolve(token('access'));
    expect((await login).message).toContain('Credential storage changed');
    expect(mocks.stored).toBe('');
    expect(mocks.invoke).not.toHaveBeenCalledWith('wallabag_session_set', expect.objectContaining({ backend: 'local' }));
  });

  it('shares one token rotation between concurrent expired-token saves', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockResolvedValueOnce(token('old', 'refresh', 1)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(saved()).mockResolvedValueOnce(saved());
    await api.connectWallabag(credentials);
    const saves = Promise.all([api.saveToWallabag(credentials.server, 'https://example.org/one'), api.saveToWallabag(credentials.server, 'https://example.org/two')]);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    pending.resolve(token('new', 'rotated'));
    await saves;
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/oauth/v2/token'))).toHaveLength(2);
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/api/entries.json')).map(([, options]) => options.headers.Authorization)).toEqual(['Bearer new', 'Bearer new']);
  });

  it('reuses a rotated token when another old-token request returns a late 401', async () => {
    const slow = deferred<Response>();
    mocks.fetch.mockImplementation(async (url, options) => {
      if (url.endsWith('/oauth/v2/token')) return JSON.parse(options.body).grant_type === 'password' ? token('old') : token('new', 'rotated');
      if (JSON.parse(options.body).url.endsWith('/slow') && options.headers.Authorization === 'Bearer old') return slow.promise;
      return options.headers.Authorization === 'Bearer old' ? new Response('', { status: 401 }) : saved();
    });
    await api.connectWallabag(credentials);
    const first = api.saveToWallabag(credentials.server, 'https://example.org/slow');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await api.saveToWallabag(credentials.server, 'https://example.org/fast');
    slow.resolve(new Response('', { status: 401 }));
    await first;
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/oauth/v2/token'))).toHaveLength(2);
    expect(JSON.parse(mocks.stored).refreshToken).toBe('rotated');
  });

  it('propagates failed native deletion and keeps the session available for a retry', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access'));
    await api.connectWallabag(credentials);
    const original = mocks.invoke.getMockImplementation()!;
    let failDelete = true;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === 'wallabag_session_delete' && failDelete) { failDelete = false; throw new Error('Keychain deletion failed'); }
      return original(command, args);
    });
    await expect(api.disconnectWallabag()).rejects.toThrow('Keychain deletion failed');
    expect(await api.wallabagConnected(credentials.server)).toBe(true);
    await api.disconnectWallabag();
    expect(await api.wallabagConnected(credentials.server)).toBe(false);
  });
});

describe('Wallabag browser persistence', () => {
  beforeEach(() => { mocks.native = false; });

  it('encrypts credentials, omits ambient cookies, and does not call native HTTP', async () => {
    mocks.browserFetch.mockResolvedValueOnce(token('browser-access')).mockResolvedValueOnce(saved());
    await api.connectWallabag(credentials);
    expect(mocks.encrypt).toHaveBeenCalledWith(expect.stringContaining('browser-access'));
    expect(localStorage.getItem(sessionKey)).not.toContain('browser-access');
    await api.saveToWallabag(credentials.server, 'https://example.org');
    expect(mocks.browserFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('observes credentials removed by another browser tab', async () => {
    mocks.browserFetch.mockResolvedValueOnce(token('browser-access'));
    await api.connectWallabag(credentials);
    expect(await api.wallabagConnected(credentials.server)).toBe(true);
    localStorage.removeItem(sessionKey);
    expect(await api.wallabagConnected(credentials.server)).toBe(false);
    await expect(api.saveToWallabag(credentials.server, 'https://example.org')).rejects.toThrow('Connect Wallabag');
    expect(mocks.browserFetch).toHaveBeenCalledTimes(1);
  });

  it('does not report a successful connection when encrypted storage fails', async () => {
    mocks.browserFetch.mockResolvedValueOnce(token('browser-access'));
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    await expect(api.connectWallabag(credentials)).rejects.toThrow('Could not save Wallabag credentials');
  });

  it('does not report successful removal when browser storage cannot be accessed', async () => {
    vi.spyOn(Object.getPrototypeOf(localStorage), 'removeItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    vi.spyOn(Object.getPrototypeOf(localStorage), 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await expect(api.disconnectWallabag()).rejects.toThrow('storage');
  });

  it('keeps the connected session if neither local-search revocation store is writable', async () => {
    mocks.native = true;
    mocks.fetch.mockResolvedValueOnce(token('original'));
    await api.connectWallabag(credentials);
    const previous = mocks.stored;
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    await expect(api.disconnectWallabag()).rejects.toThrow('storage');
    expect(mocks.stored).toBe(previous);
    expect(mocks.invoke).not.toHaveBeenCalledWith('wallabag_session_delete', expect.anything());
  });

  it('revokes the old connection after new authentication but before replacing its session', async () => {
    mocks.native = true;
    mocks.fetch.mockResolvedValueOnce(token('original')).mockResolvedValueOnce(token('replacement'));
    await api.connectWallabag(credentials);
    const previous = mocks.stored;
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    await expect(api.connectWallabag({ ...credentials, username: 'another-reader' })).rejects.toThrow('storage');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.stored).toBe(previous);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'wallabag_session_set')).toHaveLength(1);
  });

  it('reports browser connectivity/CORS failures without echoing transport secrets', async () => {
    mocks.browserFetch.mockRejectedValueOnce(new Error('Transport body had a private-test-sentinel password'));
    const error = await api.connectWallabag(credentials).catch(error => error);
    expect(error.message).toContain('browser CORS settings');
    expect(error.message).not.toContain('private-test-sentinel');
  });
});

const articlePage = (items: unknown[], pages = 1) => new Response(JSON.stringify({ _embedded: { items }, pages }), { status: 200 });
const article = { id: 1, title: 'A saved article', url: 'https://example.org/article', content: '<p>First paragraph</p><p>Later</p>', created_at: '2026-11-01T12:00:00Z', password: 'never project', annotations: ['omit'] };

describe('Wallabag search-index reads', () => {
  it('lists a bounded page with no credential in the URL and returns only article fields', async () => {
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(articlePage([article], 3));
    await api.connectWallabag(credentials);
    const scope = await api.wallabagSearchScope(credentials.server);
    const result = await api.listWallabagEntries(credentials.server, { page: 2, perPage: 25, expectedScope: scope });
    expect(result).toEqual({ scope, entries: [{ id: 1, title: article.title, url: article.url, content: article.content, createdAt: article.created_at }], hasMore: true });
    expect(mocks.fetch.mock.calls[1][0]).toBe('https://wallabag.example/api/entries.json?page=2&perPage=25&sort=created&order=desc');
    expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer access' }, redirect: 'error', maxRedirections: 0 });
    expect(scope).not.toContain('access'); expect(JSON.stringify(result)).not.toContain('never project');
  });

  it('uses browser CORS transport and refreshes once after unauthorized', async () => {
    mocks.native = false;
    mocks.browserFetch.mockResolvedValueOnce(token('old')).mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(token('new')).mockResolvedValueOnce(articlePage([article]));
    await api.connectWallabag(credentials);
    const result = await api.listWallabagEntries(credentials.server);
    expect(result.entries).toHaveLength(1);
    expect(mocks.browserFetch.mock.calls[3][1].headers.Authorization).toBe('Bearer new');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('pins an import to its connection, including reconnects on the same server', async () => {
    mocks.fetch.mockResolvedValueOnce(token('first')).mockResolvedValueOnce(token('second'));
    await api.connectWallabag(credentials);
    const oldScope = await api.wallabagSearchScope(credentials.server);
    await api.connectWallabag(credentials);
    expect(await api.wallabagSearchScope(credentials.server)).not.toBe(oldScope);
    await expect(api.listWallabagEntries(credentials.server, { expectedScope: oldScope })).rejects.toThrow('connection changed');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a response from a connection replaced while the page was being read', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockResolvedValueOnce(token('first')).mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(token('second'));
    await api.connectWallabag(credentials);
    const reading = api.listWallabagEntries(credentials.server);
    const checked = expect(reading).rejects.toThrow('connection changed');
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    await api.connectWallabag(credentials);
    pending.resolve(articlePage([article]));
    await checked;
  });

  it('cancels a page request through the supplied AbortSignal', async () => {
    const controller = new AbortController();
    mocks.fetch.mockResolvedValueOnce(token('first')).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    await api.connectWallabag(credentials);
    const reading = api.listWallabagEntries(credentials.server, { signal: controller.signal });
    const checked = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    controller.abort(); await checked;
  });

  it('rejects invalid bounds and malformed pages without following next links', async () => {
    await expect(api.listWallabagEntries(credentials.server, { perPage: 51 })).rejects.toThrow('page size');
    mocks.fetch.mockResolvedValueOnce(token('access')).mockResolvedValueOnce(new Response(JSON.stringify({ _embedded: { items: [{}] }, _links: { next: { href: 'https://other.example' } } }), { status: 200 }));
    await api.connectWallabag(credentials);
    await expect(api.listWallabagEntries(credentials.server)).rejects.toThrow('invalid article');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});


async function seedIndexedWallabag(scope: string) {
  const cache = await import('./search-cache');
  await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: true, maxAgeDays: 0 });
  await cache.cacheSearchItems([{
    source: 'wallabag', scope, id: '1', url: 'https://example.org/private-article',
    title: 'Private breadcrumb', text: 'A cached article.', createdAt: new Date().toISOString(),
  }], { strict: true });
  return cache;
}

describe('Wallabag durable cache cleanup marker', () => {
  it.each([true, false])('cleans a corrupt saved session using its independent marker (native=%s)', async native => {
    mocks.native = native;
    vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const transport = native ? mocks.fetch : mocks.browserFetch;
    transport.mockResolvedValueOnce(token('access'));
    await api.connectWallabag(credentials);
    const scope = await api.wallabagSearchScope(credentials.server);
    expect(localStorage.getItem(searchScopeKey)).toBe(scope);
    const cache = await seedIndexedWallabag(scope);
    if (native) mocks.stored = '{broken session';
    else localStorage.setItem(sessionKey, 'not encrypted JSON');
    await api.disconnectWallabag();
    expect(await cache.searchCache('breadcrumb')).toEqual([]);
    expect(localStorage.getItem(searchScopeKey)).toBeNull();
    expect(native ? mocks.stored : localStorage.getItem(sessionKey)).toBe(native ? '' : null);
    expect(await cache.cacheSearchItems([{
      source: 'wallabag', scope, id: 'late', url: article.url,
      title: 'Late breadcrumb', text: 'A stale callback.', createdAt: new Date().toISOString(),
    }])).toBe(0);
  });

  it.each([true, false])('revokes the corrupt prior connection before reconnecting (native=%s)', async native => {
    mocks.native = native;
    vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const transport = native ? mocks.fetch : mocks.browserFetch;
    transport.mockResolvedValueOnce(token('old')).mockResolvedValueOnce(token('new'));
    await api.connectWallabag(credentials);
    const oldScope = await api.wallabagSearchScope(credentials.server);
    const cache = await seedIndexedWallabag(oldScope);
    if (native) mocks.stored = '{broken session';
    else localStorage.setItem(sessionKey, 'not encrypted JSON');
    await api.connectWallabag({ ...credentials, username: 'another-reader' });
    expect(localStorage.getItem(searchScopeKey)).toBeNull();
    expect(await cache.searchCache('breadcrumb')).toEqual([]);
    const newScope = await api.wallabagSearchScope(credentials.server);
    expect(newScope).not.toBe(oldScope);
    expect(localStorage.getItem(searchScopeKey)).toBe(newScope);
  });

  it.each([true, false])('refuses article reads when a new cleanup marker cannot be saved (native=%s)', async native => {
    mocks.native = native;
    const transport = native ? mocks.fetch : mocks.browserFetch;
    transport.mockResolvedValueOnce(token('access'));
    await api.connectWallabag(credentials);
    const original = Object.getPrototypeOf(localStorage).setItem;
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === searchScopeKey) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    await expect(api.wallabagSearchScope(credentials.server)).rejects.toThrow('Could not save the Wallabag cache marker');
    await expect(api.listWallabagEntries(credentials.server)).rejects.toThrow('Could not save the Wallabag cache marker');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(searchScopeKey)).toBeNull();
    expect(await api.wallabagConnected(credentials.server)).toBe(true);
  });

  it('revokes both a readable session and a different valid marker without touching unrelated scopes', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    mocks.fetch.mockResolvedValueOnce(token('access'));
    await api.connectWallabag(credentials);
    const scope = await api.wallabagSearchScope(credentials.server);
    const markedScope = `wallabag:${crypto.randomUUID()}`;
    const cache = await seedIndexedWallabag(scope);
    await cache.cacheSearchItems([
      { source: 'wallabag', scope: markedScope, id: '2', url: article.url, title: 'Marker breadcrumb', text: '', createdAt: new Date().toISOString() },
      { source: 'mastodon', scope: 'account:7', id: '3', url: article.url, title: 'Other breadcrumb', text: '', createdAt: new Date().toISOString() },
    ]);
    localStorage.setItem(searchScopeKey, markedScope);
    await api.disconnectWallabag();
    expect((await cache.searchCache('breadcrumb')).map(hit => hit.scope)).toEqual(['account:7']);
    expect(localStorage.getItem(searchScopeKey)).toBeNull();
  });

  it('does not let an invalid marker revoke an unrelated scope', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const cache = await import('./search-cache');
    await cache.updateSearchCacheSettings({ ...cache.getSearchCacheSettings(), enabled: true });
    await cache.cacheSearchItems([{ source: 'mastodon', scope: 'account:7', id: '3', url: article.url, title: 'Other breadcrumb', text: '', createdAt: new Date().toISOString() }]);
    localStorage.setItem(searchScopeKey, 'account:7');
    await api.disconnectWallabag();
    expect((await cache.searchCache('breadcrumb')).map(hit => hit.scope)).toEqual(['account:7']);
  });
});
