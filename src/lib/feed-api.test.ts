// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { P256Keypair, Secp256k1Keypair, type Keypair } from '@atproto/crypto';
import { DidResolver } from '@atproto/identity';
import { POST as publish } from '../../api/feed/publish';
import { POST as unpublish } from '../../api/feed/unpublish';
import { GET as skeleton } from '../../api/xrpc/app.bsky.feed.getFeedSkeleton';
import { FEED_SERVICE_DID, FEED_PUBLISH_LXM, FEED_UNPUBLISH_LXM } from '../../api/_lib/feed-auth';
import { feedPath } from '../../api/_lib/feed-storage';

const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('@vercel/blob', () => blob);

const ALICE = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const definition = { userDid: ALICE, rkey: 'my-feed', query: 'svelte', name: 'Svelte', description: '' };
let signer: Keypair;
let resolveDocument: ReturnType<typeof vi.spyOn>;
const fetchMock = vi.fn();
const didDocument = (did: string, key = signer) => ({
  id: did,
  verificationMethod: [{ id: `${did}#atproto`, controller: did, type: 'Multikey', publicKeyMultibase: key.did().slice('did:key:'.length) }],
});

async function token(claims: Record<string, unknown> = {}, headers: Record<string, unknown> = {}, key = signer) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: key.jwtAlg, ...headers })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: ALICE, aud: FEED_SERVICE_DID, lxm: FEED_PUBLISH_LXM, iat: now, exp: now + 60, jti: 'test-nonce', ...claims })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${Buffer.from(await key.sign(Buffer.from(message))).toString('base64url')}`;
}

function request(body: unknown = definition, auth?: string) {
  return new Request('https://crispdeck.vercel.app/api/feed/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
}

function stored(value: unknown) {
  return { statusCode: 200, stream: new Response(JSON.stringify(value)).body };
}

function feedRequest(did = ALICE, rkey = 'my-feed', extra: Record<string, string> = {}) {
  return new Request(`https://crispdeck.vercel.app/xrpc/app.bsky.feed.getFeedSkeleton?${new URLSearchParams({ feed: `at://${did}/app.bsky.feed.generator/${rkey}`, ...extra })}`);
}

beforeAll(async () => { signer = await Secp256k1Keypair.create(); });
beforeEach(() => {
  blob.put.mockReset().mockResolvedValue({ url: 'https://store.public.blob.vercel-storage.com/feed.json' });
  blob.get.mockReset().mockResolvedValue(null);
  blob.del.mockReset().mockResolvedValue(undefined);
  resolveDocument = vi.spyOn(DidResolver.prototype, 'resolveNoCheck').mockImplementation(async (did: string) => didDocument(did));
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ posts: [], cursor: 'next' })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('feed mutation authentication', () => {
  it('rejects anonymous publish and deletion before touching storage or resolving identity', async () => {
    expect((await publish(request())).status).toBe(401);
    expect((await unpublish(request())).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
    expect(resolveDocument).not.toHaveBeenCalled();
  });

  it.each([
    { iss: BOB }, { aud: 'did:web:attacker.test' }, { aud: 'did:web:crispdeck.vercel.app' },
    { lxm: 'app.bsky.feed.getFeedSkeleton' }, { lxm: FEED_UNPUBLISH_LXM },
    { exp: 1 }, { exp: '9999999999' }, { exp: 9_999_999_999 }, { iat: 9_999_999_999 },
    { iat: 1 }, { iat: undefined }, { exp: undefined }, { nbf: 9_999_999_999 }, { jti: undefined },
  ])('rejects mismatched or invalid claims %j before resolving identity', async (claims) => {
    expect((await publish(request(definition, await token(claims)))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
    expect(resolveDocument).not.toHaveBeenCalled();
  });

  it.each([{ typ: 'at+jwt' }, { typ: 'refresh+jwt' }, { typ: undefined }, { alg: 'none' }, { kid: '#other' }, { crit: ['b64'], b64: false }])('rejects non-service or unsupported JWT headers %j', async (headers) => {
    expect((await publish(request(definition, await token({}, headers)))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
    expect(resolveDocument).not.toHaveBeenCalled();
  });

  it('verifies the signature instead of trusting decoded claims', async () => {
    const forged = await token({}, {}, await Secp256k1Keypair.create());
    expect((await publish(request(definition, forged))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('rejects an algorithm that disagrees with the DID key', async () => {
    expect((await publish(request(definition, await token({}, { alg: 'ES256' })))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('verifies the resolved document identity and key controller', async () => {
    resolveDocument.mockResolvedValue(didDocument(BOB));
    expect((await publish(request(definition, await token()))).status).toBe(401);
    const document = didDocument(ALICE);
    document.verificationMethod[0].controller = BOB;
    resolveDocument.mockResolvedValue(document);
    expect((await publish(request(definition, await token()))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it.each(['ES256K', 'ES256'])('accepts a valid owner token signed with %s and namespaces the object by owner', async (algorithm) => {
    const key = algorithm === 'ES256' ? await P256Keypair.create() : signer;
    resolveDocument.mockResolvedValue(didDocument(ALICE, key));
    const response = await publish(request(definition, await token({}, { kid: '#atproto' }, key)));
    expect(response.status).toBe(200);
    expect(blob.put).toHaveBeenCalledWith(feedPath(ALICE, definition.rkey), expect.any(String), expect.objectContaining({ access: 'public', addRandomSuffix: false, allowOverwrite: true }));
    expect(JSON.parse(blob.put.mock.calls[0][1])).toMatchObject(definition);
  });

  it.each(['did:web:localhost', 'did:web:127.0.0.1', 'did:web:169.254.169.254', 'did:web:localhost%3A8080'])('keeps the real resolver private-network protections for %s', async (did) => {
    resolveDocument.mockRestore();
    expect((await publish(request({ ...definition, userDid: did }, await token({ iss: did })))).status).toBe(401);
    expect(blob.put).not.toHaveBeenCalled();
  });
});

describe('feed storage ownership and input handling', () => {
  it.each([null, [], 1, 'string'])('rejects non-object JSON: %j', async (body) => {
    expect((await publish(request(body))).status).toBe(400);
    expect((await unpublish(request(body))).status).toBe(400);
  });

  it('returns a controlled error for invalid JSON', async () => {
    const malformed = () => new Request('https://crispdeck.vercel.app/api/feed/publish', { method: 'POST', body: '{broken' });
    expect((await publish(malformed())).status).toBe(400);
    expect((await unpublish(malformed())).status).toBe(400);
  });

  it('bounds JSON bodies even without a Content-Length header', async () => {
    expect((await publish(request({ ...definition, query: 'a'.repeat(20_000) }))).status).toBe(413);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it.each(['../other', '.', '..', 'prefix/file', 'bad?query', 'x'.repeat(513)])('refuses an invalid record key %s', async (rkey) => {
    expect((await publish(request({ ...definition, rkey }))).status).toBe(400);
    expect((await unpublish(request({ ...definition, rkey }))).status).toBe(400);
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('deletes only an authenticated owner namespace and leaves another owner’s legacy record', async () => {
    blob.get.mockResolvedValueOnce(stored({ ...definition, userDid: BOB }));
    expect((await unpublish(request(definition, await token({ lxm: FEED_UNPUBLISH_LXM })))).status).toBe(200);
    expect(blob.del).toHaveBeenCalledExactlyOnceWith(feedPath(ALICE, definition.rkey));
  });

  it('can remove an exact legacy record only for its verified owner', async () => {
    blob.get.mockResolvedValueOnce(stored(definition));
    expect((await unpublish(request(definition, await token({ lxm: FEED_UNPUBLISH_LXM })))).status).toBe(200);
    expect(blob.del.mock.calls.map(([path]) => path)).toEqual([feedPath(ALICE, definition.rkey), `feeds/${definition.rkey}.json`]);
  });

  it('refuses a publish token for deletion', async () => {
    expect((await unpublish(request(definition, await token()))).status).toBe(401);
    expect(blob.del).not.toHaveBeenCalled();
  });
});

describe('public feed resolution', () => {
  it('isolates stored queries and cache entries for two DIDs sharing a record key', async () => {
    const rkey = 'shared-rkey';
    blob.get.mockImplementation(async (path: string) => stored({ ...definition, rkey,
      userDid: path === feedPath(ALICE, rkey) ? ALICE : BOB,
      query: path === feedPath(ALICE, rkey) ? 'alice-query' : 'bob-query',
    }));
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ posts: [] })));
    expect((await skeleton(feedRequest(ALICE, rkey))).status).toBe(200);
    expect((await skeleton(feedRequest(BOB, rkey))).status).toBe(200);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('q'))).toEqual(['alice-query', 'bob-query']);
  });

  it('does not serve another DID’s legacy definition', async () => {
    blob.get.mockResolvedValueOnce(null).mockResolvedValueOnce(stored({ ...definition, rkey: 'legacy-other', userDid: BOB }));
    expect((await skeleton(feedRequest(ALICE, 'legacy-other'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves correctly owned legacy definitions', async () => {
    blob.get.mockResolvedValueOnce(null).mockResolvedValueOnce(stored({ ...definition, rkey: 'legacy-owned' }));
    expect((await skeleton(feedRequest(ALICE, 'legacy-owned'))).status).toBe(200);
    expect(blob.get).toHaveBeenNthCalledWith(2, 'feeds/legacy-owned.json', expect.anything());
  });

  it.each(['-1', '0', '101', '1.5', 'NaN', 'Infinity'])('rejects invalid limits %s before reading storage', async (limit) => {
    expect((await skeleton(feedRequest(ALICE, 'limit-test', { limit }))).status).toBe(400);
    expect(blob.get).not.toHaveBeenCalled();
  });
});
