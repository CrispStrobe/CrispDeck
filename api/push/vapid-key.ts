/**
 * Returns the VAPID public key from environment variables.
 * Clients use this to subscribe to web push notifications.
 */
export function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ key }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
