/**
 * Vercel serverless function: Remove a feed definition from Vercel Blob.
 *
 * Called by the CrispDeck client when unpublishing a feed.
 *
 * POST body: { rkey }
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
  const { rkey } = body ?? {};

  if (!rkey) {
    return new Response(JSON.stringify({ error: 'Missing required field: rkey' }), { status: 400, headers: corsHeaders });
  }

  try {
    const { del, list } = await import('@vercel/blob');
    const blobs = await list({ prefix: `feeds/${rkey}.json` });
    for (const blob of blobs.blobs) {
      await del(blob.url);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to delete feed definition', detail: String(e) }), { status: 500, headers: corsHeaders });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
