import { verifySignature } from '@atproto/crypto';
import { DidResolver, getDidKeyFromMultibase } from '@atproto/identity';
import { HttpError } from './request.js';

export const FEED_SERVICE_DID = 'did:web:crispdeck.vercel.app#bsky_fg';
export const FEED_PUBLISH_LXM = 'app.vercel.crispdeck.feed.publish';
export const FEED_UNPUBLISH_LXM = 'app.vercel.crispdeck.feed.unpublish';

// Keep the resolver's default fetch: it blocks private/reserved destinations
// at connection time (including DNS rebinding), limits response size and does
// not follow DID-document redirects. Never inject plain fetch here.
const resolver = new DidResolver({ timeout: 5_000 });

export function isAccountDid(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 &&
    /^did:(?:plc:[a-z2-7]{24}|web:[a-zA-Z0-9._:%-]+)$/.test(value);
}

/** Authenticate a short-lived, action-bound token signed by the owner's PDS. */
export async function authorizeFeedMutation(request: Request, userDid: string, lxm: string): Promise<void> {
  try {
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization.length > 8192) throw new Error();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) throw new Error();
    const [encodedHeader, encodedPayload, encodedSignature] = match[1].split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!header || !payload || Array.isArray(header) || Array.isArray(payload)) throw new Error();

    // Service tokens are separate from account access/refresh tokens. Only the
    // repo signing key is accepted; unrelated keys in a DID doc cannot mutate feeds.
    if (header.typ !== 'JWT' || !['ES256K', 'ES256'].includes(header.alg) ||
        (header.kid !== undefined && header.kid !== '#atproto') ||
        (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.length !== 0))) throw new Error();

    const now = Math.floor(Date.now() / 1000);
    if (!isAccountDid(payload.iss) || payload.iss !== userDid ||
        payload.aud !== FEED_SERVICE_DID || payload.lxm !== lxm ||
        !Number.isSafeInteger(payload.exp) || payload.exp <= now || payload.exp > now + 120 ||
        !Number.isSafeInteger(payload.iat) || payload.iat > now + 5 || payload.iat < now - 120 ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 120 ||
        (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > now)) ||
        typeof payload.jti !== 'string' || !payload.jti || payload.jti.length > 256) throw new Error();

    const document = await resolver.ensureResolve(payload.iss);
    const method = document.verificationMethod?.find((key) =>
      (key.id === '#atproto' || key.id === `${payload.iss}#atproto`) && key.controller === payload.iss &&
      ['Multikey', 'EcdsaSecp256k1VerificationKey2019', 'EcdsaSecp256r1VerificationKey2019'].includes(key.type) &&
      typeof key.publicKeyMultibase === 'string');
    if (!method?.publicKeyMultibase) throw new Error();
    const signingKey = getDidKeyFromMultibase({ type: method.type, publicKeyMultibase: method.publicKeyMultibase });
    if (!signingKey) throw new Error();
    if (!await verifySignature(signingKey, Buffer.from(`${encodedHeader}.${encodedPayload}`),
      Buffer.from(encodedSignature, 'base64url'), { jwtAlg: header.alg })) throw new Error();
  } catch {
    // Neither the token nor a DID resolver exception belongs in a response/log.
    throw new HttpError(401, 'A valid feed-owner service token is required');
  }
}
