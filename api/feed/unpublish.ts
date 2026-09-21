import { corsFor, preflight, safeError } from '../_lib/cors.js';
/**
 * Vercel serverless function: Remove a feed definition from Vercel Blob.
 *
 * Called by the CrispDeck client when unpublishing a feed.
 *
 * POST body: { rkey }
 *
 * Env vars required: BLOB_READ_WRITE_TOKEN (auto-set by Vercel Blob)
 */


export async function POST(request: Request) {
  const body = await request.json();
  const { rkey } = body ?? {};

  if (!rkey) {
    return new Response(JSON.stringify({ error: 'Missing required field: rkey' }), { status: 400, headers: corsFor(request, 'POST, OPTIONS') });
  }

  try {
    const { del, list } = await import('@vercel/blob');
    const blobs = await list({ prefix: `feeds/${rkey}.json` });
    for (const blob of blobs.blobs) {
      await del(blob.url);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsFor(request, 'POST, OPTIONS') });
  } catch (e) {
    return new Response(JSON.stringify({ error: safeError('Deleting the feed definition', e) }), { status: 500, headers: corsFor(request, 'POST, OPTIONS') });
  }
}

export function OPTIONS(request: Request) {
  return preflight(request, 'POST, OPTIONS');
}
