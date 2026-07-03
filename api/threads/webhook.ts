/**
 * Vercel serverless function: Threads deauthorize/delete webhook.
 *
 * Meta requires Uninstall and Delete callback URLs to be set.
 * This endpoint acknowledges the request — actual credential cleanup
 * happens client-side (localStorage/IndexedDB are per-browser).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function POST() {
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
}

export async function GET() {
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders });
}
