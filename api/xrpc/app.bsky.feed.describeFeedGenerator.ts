/**
 * Vercel serverless function: Bluesky Feed Generator — describeFeedGenerator
 *
 * Returns metadata about this feed generator service.
 * Called by the Bluesky AppView to verify the generator is valid.
 */

const GENERATOR_DID = 'did:web:crispdeck.vercel.app';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function GET() {
  return new Response(JSON.stringify({
    did: GENERATOR_DID,
    feeds: [],
  }), { status: 200, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
