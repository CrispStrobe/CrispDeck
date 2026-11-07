import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true, backend: 'keychain', keychain: 'login', stored: '',
  invoke: vi.fn(), getBackend: vi.fn(), fetch: vi.fn(), browserFetch: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => mocks.native, invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('$lib/db', () => ({ getCredentialBackend: mocks.getBackend }));
vi.mock('$lib/browser-db', () => ({ encrypt: async (value: string) => btoa(value), decrypt: async (value: string) => atob(value) }));

let api: typeof import('./wallabag');
const server = 'https://read.example/wallabag';
const sessionKey = 'crispdeck-wallabag-session';
const session = (changes: Record<string, unknown> = {}) => ({
  server, clientId: 'client', clientSecret: 'secret', accessToken: 'access', refreshToken: 'refresh',
  expiresAt: Date.now() + 3600_000, connectionId: 'connection-one', ...changes,
});
const entry = (changes: Record<string, unknown> = {}) => ({
  id: 42, title: 'A saved article', url: 'https://example.org/article', content: '<p>Article body</p>',
  is_archived: 0, is_starred: 1, created_at: '2026-11-07T12:00:00+00:00', reading_time: 3,
  domain_name: 'example.org', tags: [{ id: 2, label: 'Reading', slug: 'reading' }], ...changes,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const page = (items: unknown[] = [], changes: Record<string, unknown> = {}) => json({
  _embedded: { items }, page: 1, pages: 1, total: items.length, limit: 30, ...changes,
});
const token = () => json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
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
  mocks.keychain = 'login';
  mocks.stored = JSON.stringify(session());
  mocks.getBackend.mockImplementation(async () => ({ backend: mocks.backend, macosKeychain: mocks.keychain }));
  mocks.invoke.mockImplementation(async (command, args) => {
    if (args.backend !== mocks.backend || args.keychain !== mocks.keychain) throw new Error('Credential storage changed');
    if (command === 'wallabag_session_get') return mocks.stored || null;
    if (command === 'wallabag_session_set') mocks.stored = args.value;
    if (command === 'wallabag_session_delete') mocks.stored = '';
  });
  localStorage.clear();
  vi.stubGlobal('fetch', mocks.browserFetch);
  api = await import('./wallabag');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reader availability requires saved credentials that the server accepts', () => {
  it('does not enable a reader for a configured URL without saved credentials', async () => {
    mocks.stored = '';
    expect(await api.validateWallabagConnection(server)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['not a URL', 'https://another.example', 'http://insecure.example'])('does not send credentials to an invalid or different server: %s', async value => {
    expect(await api.validateWallabagConnection(value)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['null', '{}', '{"accessToken":"private-test-sentinel"'])('keeps malformed saved credentials hidden %#', async value => {
    mocks.stored = value;
    expect(await api.validateWallabagConnection(server)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('authenticates an empty library without requesting full article bodies', async () => {
    mocks.fetch.mockResolvedValueOnce(page([], { pages: 0 }));
    expect(await api.validateWallabagConnection(server + '/')).toBe(true);
    const [url, options] = mocks.fetch.mock.calls[0];
    const target = new URL(url);
    expect(target.pathname).toBe('/wallabag/api/entries.json');
    expect(Object.fromEntries(target.searchParams)).toMatchObject({ perPage: '1', detail: 'metadata' });
    expect(target.searchParams.has('archive')).toBe(false);
    expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer access' }, redirect: 'error', maxRedirections: 0, credentials: 'omit', cache: 'no-store' });
  });

  it('refreshes an expired saved session before checking availability and persists rotation', async () => {
    mocks.stored = JSON.stringify(session({ expiresAt: Date.now() - 1000 }));
    mocks.fetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(page());
    expect(await api.validateWallabagConnection(server)).toBe(true);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${server}/oauth/v2/token`);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      grant_type: 'refresh_token', client_id: 'client', client_secret: 'secret', refresh_token: 'refresh',
    });
    expect(mocks.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer rotated-access');
    expect(JSON.parse(mocks.stored).refreshToken).toBe('rotated-refresh');
  });

  it.each([401, 403, 500])('keeps rejected credentials or an unavailable API hidden (%i)', async status => {
    mocks.fetch.mockResolvedValueOnce(json({ error: 'private-test-sentinel' }, status));
    if (status === 401) mocks.fetch.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    expect(await api.validateWallabagConnection(server)).toBe(false);
  });

  it('requires a valid entries response, not merely a 200 response from an HTML login page', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('<html>Sign in</html>'));
    expect(await api.validateWallabagConnection(server)).toBe(false);
  });

  it('keeps a browser connection hidden when the API fails CORS/network access', async () => {
    mocks.native = false;
    localStorage.setItem(sessionKey, btoa(JSON.stringify(session())));
    mocks.browserFetch.mockRejectedValueOnce(new Error('Failed to fetch with private-test-sentinel'));
    expect(await api.validateWallabagConnection(server)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('Wallabag reader entries', () => {
  it.each([
    ['unread', { archive: '0' }],
    ['archived', { archive: '1' }],
    ['starred', { starred: '1' }],
    ['all', {}],
  ] as const)('requests the %s filter and server pagination', async (filter, expected) => {
    mocks.fetch.mockResolvedValueOnce(page([entry({ content: undefined })], { page: 2, pages: 4, total: 100 }));
    const result = await api.listWallabagEntries(server, { filter, page: 2, perPage: 25 });
    const query = Object.fromEntries(new URL(mocks.fetch.mock.calls[0][0]).searchParams);
    expect(query).toEqual({ page: '2', perPage: '25', sort: 'created', order: 'desc', detail: 'metadata', ...expected });
    expect(result).toMatchObject({ page: 2, pages: 4, total: 100 });
    expect(result.items[0]).toMatchObject({ id: 42, content: '', is_archived: false, is_starred: true });
  });

  it('fetches full article content on demand and handles legacy nullable fields', async () => {
    mocks.fetch.mockResolvedValueOnce(json(entry({ title: null, url: null, is_archived: true, is_starred: false, tags: ['Imported', { label: 'A tag' }] })));
    const result = await api.getWallabagEntry(server, 42);
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${server}/api/entries/42.json`);
    expect(result).toMatchObject({ title: '', url: '', content: '<p>Article body</p>', is_archived: true, is_starred: false, reading_time: 3, tags: [{ label: 'Imported' }, { label: 'A tag' }] });
  });

  it('archives and unstars with numeric API flags, returning server state', async () => {
    mocks.fetch.mockResolvedValueOnce(json(entry({ is_archived: 1, is_starred: 0 })));
    const result = await api.updateWallabagEntry(server, 42, { archive: true, starred: false });
    expect(mocks.fetch.mock.calls[0][0]).toBe(`${server}/api/entries/42.json`);
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' } });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ archive: 1, starred: 0 });
    expect(result).toMatchObject({ is_archived: true, is_starred: false });
  });

  it('leaves unspecified article fields out of a patch', async () => {
    mocks.fetch.mockResolvedValueOnce(json(entry({ is_starred: false })));
    await api.updateWallabagEntry(server, 42, { starred: false });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ starred: 0 });
  });

  it('retries a rejected article request once after token refresh', async () => {
    mocks.fetch.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(token()).mockResolvedValueOnce(json(entry()));
    expect((await api.getWallabagEntry(server, 42)).id).toBe(42);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer rotated-access');
  });

  it('invalidates the reader if refreshed credentials are still rejected, without looping', async () => {
    const invalidated = vi.fn();
    window.addEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated);
    try {
      mocks.fetch.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ secret: 'private-test-sentinel' }, 401));
      await expect(api.getWallabagEntry(server, 42)).rejects.toThrow('Wallabag could not load the article (401)');
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
      expect(invalidated).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated); }
  });

  it('invalidates the reader when its refresh token is no longer accepted', async () => {
    const invalidated = vi.fn();
    window.addEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated);
    try {
      mocks.stored = JSON.stringify(session({ expiresAt: 1 }));
      mocks.fetch.mockResolvedValueOnce(json({}, 400));
      await expect(api.listWallabagEntries(server)).rejects.toThrow('authentication failed (400)');
      expect(invalidated).toHaveBeenCalledTimes(1);
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated); }
  });

  it('reports an article 404 without invalidating working credentials or exposing response bodies', async () => {
    const invalidated = vi.fn();
    window.addEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated);
    try {
      mocks.fetch.mockResolvedValueOnce(json({ error: 'private-test-sentinel' }, 404));
      const error = await api.getWallabagEntry(server, 42).catch(error => error);
      expect(error.message).toBe('Wallabag could not load the article (404)');
      expect(invalidated).not.toHaveBeenCalled();
    } finally { window.removeEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated); }
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe article IDs before making requests: %s', async id => {
    await expect(api.getWallabagEntry(server, id)).rejects.toThrow('article ID');
    await expect(api.updateWallabagEntry(server, id, { archive: true })).rejects.toThrow('article ID');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid pagination and empty or non-boolean updates', async () => {
    await expect(api.listWallabagEntries(server, { page: 0 })).rejects.toThrow('list options');
    await expect(api.listWallabagEntries(server, { perPage: 101 })).rejects.toThrow('list options');
    await expect(api.updateWallabagEntry(server, 42, {})).rejects.toThrow('article update');
    await expect(api.updateWallabagEntry(server, 42, { archive: 'false' as unknown as boolean })).rejects.toThrow('article update');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('reader response validation and account lifecycle', () => {
  it.each([
    null, {}, { _embedded: { items: {} }, page: 1, pages: 1, total: 0 },
    { _embedded: { items: [entry()] }, page: 1, pages: 0, total: 1 },
    { _embedded: { items: [entry({ id: -1 })] }, page: 1, pages: 1, total: 1 },
  ])('rejects malformed article lists %#', async value => {
    mocks.fetch.mockResolvedValueOnce(json(value));
    await expect(api.listWallabagEntries(server)).rejects.toThrow('invalid article');
  });

  it.each([
    entry({ id: 43 }), entry({ is_archived: 'false' }), entry({ content: { html: 'private-test-sentinel' } }),
  ])('rejects inconsistent or malformed detail responses %#', async value => {
    mocks.fetch.mockResolvedValueOnce(json(value));
    await expect(api.getWallabagEntry(server, 42)).rejects.toThrow('invalid article');
  });

  it('bounds article bodies before parsing them', async () => {
    mocks.fetch.mockResolvedValueOnce(json(entry({ content: 'x'.repeat(5 * 1024 * 1024) })));
    await expect(api.getWallabagEntry(server, 42)).rejects.toThrow('invalid article');
  });

  it('does not echo a malformed article body in a JSON error', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{"private-test-sentinel"'));
    const error = await api.getWallabagEntry(server, 42).catch(error => error);
    expect(error.message).toBe('Wallabag returned an invalid article');
  });

  it('discards an article fetched before disconnect', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const article = api.getWallabagEntry(server, 42).catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await api.disconnectWallabag();
    pending.resolve(json(entry()));
    expect((await article).message).toContain('connection changed');
    expect(mocks.stored).toBe('');
  });

  it('discards an article fetched with a different native credential backend', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const article = api.getWallabagEntry(server, 42).catch(error => error);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.backend = 'local';
    pending.resolve(json(entry()));
    expect((await article).message).toContain('connection changed');
  });

  it('does not show another browser tab’s replaced or removed account data', async () => {
    mocks.native = false;
    localStorage.setItem(sessionKey, btoa(JSON.stringify(session())));
    const pending = deferred<Response>();
    mocks.browserFetch.mockReturnValueOnce(pending.promise);
    const articles = api.listWallabagEntries(server).catch(error => error);
    await vi.waitFor(() => expect(mocks.browserFetch).toHaveBeenCalledTimes(1));
    localStorage.setItem(sessionKey, btoa(JSON.stringify(session({ connectionId: 'connection-two', accessToken: 'another-account' }))));
    pending.resolve(page([entry()]));
    expect((await articles).message).toContain('connection changed');
  });

  it('does not let an old authorization failure hide a newly connected account', async () => {
    const invalidated = vi.fn();
    window.addEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated);
    try {
      const pending = deferred<Response>();
      mocks.fetch.mockReturnValueOnce(pending.promise);
      const article = api.getWallabagEntry(server, 42).catch(error => error);
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
      mocks.stored = JSON.stringify(session({ connectionId: 'connection-two', accessToken: 'another-account' }));
      pending.resolve(json({}, 403));
      expect((await article).message).toContain('connection changed');
      expect(invalidated).not.toHaveBeenCalled();
    } finally { window.removeEventListener(api.WALLABAG_CONNECTION_CHANGED, invalidated); }
  });

  it('does not enable the reader after a delayed validation is disconnected', async () => {
    const pending = deferred<Response>();
    mocks.fetch.mockReturnValueOnce(pending.promise);
    const checking = api.validateWallabagConnection(server);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await api.disconnectWallabag();
    pending.resolve(page());
    expect(await checking).toBe(false);
  });
});
