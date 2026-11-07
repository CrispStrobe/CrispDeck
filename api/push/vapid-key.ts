import { corsFor, preflight } from '../_lib/cors.js';
/**
 * Background delivery is a stub; configured keys do not make it available.
 * Keep this unavailable until there is a working, privacy-preserving sender.
 */
export function GET(request: Request) {
  return new Response(JSON.stringify({ error: 'Background web push is not available', configured: false }), {
    status: 501,
    headers: { ...corsFor(request, 'GET, OPTIONS'), 'Cache-Control': 'no-store' },
  });
}

export function OPTIONS(request: Request) {
  return preflight(request, 'GET, OPTIONS');
}
