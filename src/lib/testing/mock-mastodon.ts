/**
 * A Mastodon instance's OAuth surface, served over real HTTP on 127.0.0.1,
 * for tests. Test-only; nothing in the app imports it.
 *
 * It enforces the rules the real instance (Doorkeeper) applies, which a
 * per-call fetch stub cannot: the redirect URI must equal the registered one
 * exactly, requested scopes must be within the registered ones, a code works
 * once, a deleted app is answered with 401, a revoked token stops working.
 * Each rule here was checked against mastodon.social / fosstodon.org.
 *
 * GET /oauth/authorize answers as if a signed-in user pressed "Authorize":
 * a 302 to the redirect URI, which is what the sign-in window intercepts.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

/** The scopes Mastodon knows; registering anything else is refused. */
const KNOWN_SCOPES = new Set([
  'read', 'write', 'follow', 'push', 'profile',
  ...['accounts', 'blocks', 'bookmarks', 'favourites', 'filters', 'follows', 'lists', 'mutes', 'notifications', 'search', 'statuses']
    .map((s) => `read:${s}`),
  ...['accounts', 'blocks', 'bookmarks', 'conversations', 'favourites', 'filters', 'follows', 'lists', 'media', 'mutes', 'notifications', 'reports', 'statuses']
    .map((s) => `write:${s}`),
]);

interface App { client_id: string; client_secret: string; redirect_uris: string[]; scopes: string[] }
interface Grant { client_id: string; redirect_uri: string; scopes: string[] }

export interface MockMastodon {
  url: string;
  /** Every request as "METHOD /path". */
  requests: string[];
  apps: Map<string, App>;
  /** What an admin deleting the app (or an instance reset) does. */
  deleteApp(clientId: string): void;
  close(): Promise<void>;
}

const token = () => randomBytes(16).toString('hex');
const scopesOf = (s: unknown) => String(s ?? 'read').split(/[\s+]+/).filter(Boolean);

async function bodyOf(req: IncomingMessage): Promise<Record<string, string>> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  if ((req.headers['content-type'] ?? '').includes('json')) return JSON.parse(raw);
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function startMockMastodon(): Promise<MockMastodon> {
  const apps = new Map<string, App>();
  const codes = new Map<string, Grant>();
  const tokens = new Map<string, { client_id: string; user: boolean }>();
  const requests: string[] = [];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    requests.push(`${req.method} ${url.pathname}`);
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    const authClient = (b: Record<string, string>) => {
      const app = apps.get(b.client_id);
      return app && app.client_secret === b.client_secret ? app : undefined;
    };

    if (req.method === 'POST' && url.pathname === '/api/v1/apps') {
      const b = await bodyOf(req);
      const redirect_uris = String(b.redirect_uris ?? '').split(/\s+/).filter(Boolean);
      const scopes = scopesOf(b.scopes);
      if (!b.client_name || redirect_uris.length === 0) return send(422, { error: 'Validation failed' });
      if (scopes.some((s) => !KNOWN_SCOPES.has(s))) return send(422, { error: 'Validation failed: Scopes are invalid' });
      const app = { client_id: token(), client_secret: token(), redirect_uris, scopes };
      apps.set(app.client_id, app);
      return send(200, { ...app, redirect_uri: redirect_uris.join('\n'), name: b.client_name });
    }

    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const q = Object.fromEntries(url.searchParams);
      const app = apps.get(q.client_id);
      // Doorkeeper shows an error page, not a redirect, when it cannot trust
      // the redirect URI.
      if (!app) return send(400, { error: 'invalid_client' });
      if (!app.redirect_uris.includes(q.redirect_uri)) return send(400, { error: 'invalid_redirect_uri' });
      const back = (params: Record<string, string>) => {
        const sep = q.redirect_uri.includes('?') ? '&' : '?';
        res.writeHead(302, { location: `${q.redirect_uri}${sep}${new URLSearchParams(params)}` });
        res.end();
      };
      const state = q.state ? { state: q.state } : {};
      if (q.response_type !== 'code') return back({ error: 'unsupported_response_type', ...state });
      const scopes = scopesOf(q.scope);
      if (scopes.some((s) => !app.scopes.includes(s))) return back({ error: 'invalid_scope', ...state });
      const code = token();
      codes.set(code, { client_id: app.client_id, redirect_uri: q.redirect_uri, scopes });
      return back({ code, ...state });
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const b = await bodyOf(req);
      const app = authClient(b);
      if (!app) return send(401, { error: 'invalid_client' });
      if (b.grant_type === 'client_credentials') {
        const t = token();
        tokens.set(t, { client_id: app.client_id, user: false });
        return send(200, { access_token: t, token_type: 'Bearer', scope: 'read' });
      }
      if (b.grant_type === 'authorization_code') {
        const grant = codes.get(b.code);
        codes.delete(b.code);
        if (!grant || grant.client_id !== app.client_id || grant.redirect_uri !== b.redirect_uri) {
          return send(400, { error: 'invalid_grant', error_description: 'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.' });
        }
        const t = token();
        tokens.set(t, { client_id: app.client_id, user: true });
        return send(200, { access_token: t, token_type: 'Bearer', scope: grant.scopes.join(' '), created_at: Math.floor(Date.now() / 1000) });
      }
      return send(400, { error: 'unsupported_grant_type' });
    }

    if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
      const b = await bodyOf(req);
      const app = authClient(b);
      if (!app) return send(403, { error: 'unauthorized_client' });
      if (tokens.get(b.token)?.client_id === app.client_id) tokens.delete(b.token);
      return send(200, {});
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/accounts/verify_credentials') {
      const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!tokens.get(t)?.user) return send(401, { error: 'The access token is invalid' });
      return send(200, { id: '1', username: 'tester', acct: 'tester' });
    }

    send(404, { error: 'Record not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    apps,
    deleteApp(clientId) {
      apps.delete(clientId);
      for (const [t, v] of tokens) if (v.client_id === clientId) tokens.delete(t);
    },
    // fetch keeps connections alive; close() alone would wait on them.
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
