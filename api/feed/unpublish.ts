import { corsFor, preflight, safeError } from '../_lib/cors.js';
import { authorizeFeedMutation, FEED_UNPUBLISH_LXM, isAccountDid } from '../_lib/feed-auth.js';
import { feedPath, isFeedRkey, readFeedDefinition } from '../_lib/feed-storage.js';
import { HttpError, readJsonObject } from '../_lib/request.js';
/**
 * Vercel serverless function: Remove a feed definition from Vercel Blob.
 *
 * Called by the CrispDeck client when unpublishing a feed.
 *
 * POST body: { rkey, userDid }, with an owner service token in Authorization.
 *
 * Env vars required: BLOB_READ_WRITE_TOKEN (auto-set by Vercel Blob)
 */


export async function POST(request: Request) {
  try {
    const { rkey, userDid } = await readJsonObject(request);
    if (!isFeedRkey(rkey) || !isAccountDid(userDid)) throw new HttpError(400, 'Invalid feed owner or record key');
    await authorizeFeedMutation(request, userDid, FEED_UNPUBLISH_LXM);

    const { del } = await import('@vercel/blob');
    await del(feedPath(userDid, rkey));
    // Old versions used a global rkey namespace. Only remove an exact legacy
    // object after verifying its owner, never every object matching a prefix.
    const legacyPath = `feeds/${rkey}.json`;
    const legacy = await readFeedDefinition(legacyPath);
    if (legacy?.userDid === userDid && legacy.rkey === rkey) await del(legacyPath);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsFor(request, 'POST, OPTIONS') });
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ error: e.message }), {
      status: e.status, headers: { ...corsFor(request), 'Cache-Control': 'no-store', ...(e.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) },
    });
    return new Response(JSON.stringify({ error: safeError('Deleting the feed definition', e) }), { status: 500, headers: corsFor(request, 'POST, OPTIONS') });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, 'POST, OPTIONS');
}
