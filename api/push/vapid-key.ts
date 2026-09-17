import { corsFor, preflight } from '../_lib/cors';
/**
 * Returns the VAPID public key from environment variables.
 * Clients use this to subscribe to web push notifications.
 */
export function GET(request: Request) {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 404,
      headers: corsFor(request, 'GET, OPTIONS'),
    });
  }
  return new Response(JSON.stringify({ key }), {
    status: 200,
    headers: corsFor(request, 'GET, OPTIONS'),
  });
}

export function OPTIONS(request: Request) {
  return preflight(request, 'GET, OPTIONS');
}
