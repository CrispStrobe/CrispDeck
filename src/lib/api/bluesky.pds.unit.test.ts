import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlueskyClient, resolvePdsEndpoint } from './bluesky';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const PDS = 'https://pds.example.com';
const FALLBACK = 'https://bsky.social';
const service = (endpoint: unknown = PDS, id = '#atproto_pds', type = 'AtprotoPersonalDataServer') => ({
  id, type, serviceEndpoint: endpoint,
});
const document = (services: unknown = [service()], id = DID) => ({ id, service: services });
const reply = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('PDS discovery before app-password login', () => {
  it('resolves a handle through its DID document', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ did: DID })).mockResolvedValueOnce(reply(document()));
    vi.stubGlobal('fetch', fetcher);
    expect(await resolvePdsEndpoint('alice.example.com')).toBe(PDS);
    expect(fetcher.mock.calls[1][0]).toBe(`https://plc.directory/${DID}`);
  });

  it('accepts a fully-qualified service ID for the resolved DID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(document([service(PDS, `${DID}#atproto_pds`)]))));
    expect(await resolvePdsEndpoint(DID)).toBe(PDS);
  });

  it('does not accept a document for another identity', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(document([service()], 'did:plc:other'))));
    expect(await resolvePdsEndpoint(DID)).toBe(FALLBACK);
  });

  it.each([
    service(PDS, '#other_service'),
    service(PDS, '#atproto_pds', 'OtherService'),
    service(PDS, 'did:web:other.example.com#atproto_pds'),
  ])('requires the PDS service ID and type together: %j', async entry => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(document([entry]))));
    expect(await resolvePdsEndpoint(DID)).toBe(FALLBACK);
  });

  it.each([
    'http://pds.example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://name:password@pds.example.com',
    'https://pds.example.com/another-service',
    'https://pds.example.com?token=secret',
    'https://pds.example.com#fragment',
    { uri: PDS },
    null,
  ])('never discovers an unsafe credential destination: %j', async endpoint => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(document([service(endpoint)]))));
    expect(await resolvePdsEndpoint(DID)).toBe(FALLBACK);
  });

  it('normalizes a root slash and retains an HTTPS port', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(document([service(`${PDS}:8443/`)]))));
    expect(await resolvePdsEndpoint(DID)).toBe(`${PDS}:8443`);
  });

  it('resolves a hostname-level did:web document', async () => {
    const did = 'did:web:alice.example.com';
    const fetcher = vi.fn().mockResolvedValue(reply(document([service()], did)));
    vi.stubGlobal('fetch', fetcher);
    expect(await resolvePdsEndpoint(did)).toBe(PDS);
    expect(fetcher.mock.calls[0][0]).toBe('https://alice.example.com/.well-known/did.json');
  });

  it.each([
    'did:web:trusted.example.com@attacker.example.com',
    'did:web:trusted.example.com/path',
    'did:web:trusted.example.com?path',
    'did:web:trusted.example.com#fragment',
    'did:plc:example/../../another',
  ])('rejects a DID that would change the lookup URL: %s', async did => {
    const fetcher = vi.fn().mockResolvedValue(reply(document([service()], did)));
    vi.stubGlobal('fetch', fetcher);
    expect(await resolvePdsEndpoint(did)).toBe(FALLBACK);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, [], { id: DID, service: {} }, { id: DID, service: [null, false] }])('handles malformed documents: %j', async doc => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(doc)));
    expect(await resolvePdsEndpoint(DID)).toBe(FALLBACK);
  });

  it('keeps the known fallback for a failed handle lookup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    expect(await resolvePdsEndpoint('alice.example.com')).toBe(FALLBACK);
  });

  it.each(['http://pds.example.com', 'https://pds.example.com/path', 'https://user:secret@pds.example.com'])('rejects an unsafe explicit PDS before constructing an authenticated client: %s', endpoint => {
    expect(() => new BlueskyClient('alice.example.com', 'app-password', endpoint)).toThrow(/HTTPS.*origin/);
  });
});
