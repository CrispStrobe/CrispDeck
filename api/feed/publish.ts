/**
 * Vercel serverless function: Store a feed definition in Vercel Blob.
 *
 * Called by the CrispDeck client when publishing a feed to the Bluesky network.
 * The client also creates the app.bsky.feed.generator record on the user's PDS.
 *
 * POST body: { rkey, query, name, description, userDid }
 *
 * Env vars required: BLOB_READ_WRITE_TOKEN (auto-set by Vercel Blob)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function POST(request: Request) {
  const body = await request.json();
  const { rkey, query, name, description, userDid } = body ?? {};

  if (!rkey || !query || !userDid) {
    return new Response(JSON.stringify({ error: 'Missing required fields: rkey, query, userDid' }), { status: 400, headers: corsHeaders });
  }

  try {
    const { put } = await import('@vercel/blob');
    const feedDef = {
      rkey,
      query,
      name: name || 'CrispDeck Feed',
      description: description || '',
      userDid,
      createdAt: new Date().toISOString(),
    };

    const blob = await put(`feeds/${rkey}.json`, JSON.stringify(feedDef), {
      contentType: 'application/json',
      access: 'public',
      addRandomSuffix: false,
    });

    return new Response(JSON.stringify({ ok: true, url: blob.url }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to store feed definition', detail: String(e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
