/**
 * Cron job endpoint for sending web push notifications.
 *
 * Called daily by Vercel Cron. For each stored subscription,
 * checks for new notifications and sends push messages via VAPID.
 *
 * Requires env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, CRON_SECRET
 *
 * DO NOT set those env vars to "turn web push on". This handler is a stub: it
 * sends nothing. Setting them only makes the settings page stop saying "VAPID
 * keys not configured" and start saying "Push notifications active", which
 * would be a lie — the browser would subscribe, the subscription would be
 * stored, and no notification would ever arrive.
 *
 * Finishing it is not a configuration task. Sending a push while the app is
 * closed means something has to poll the user's networks on their behalf,
 * which means their credentials on a server. CrispDeck keeps credentials on
 * the device, encrypted, and the privacy policy says so in as many words:
 * "None of this data is transmitted to the developer or any third party."
 * Implementing this as sketched below would make that untrue.
 *
 * What does work today, and needs none of this, is notifying from the client
 * while the app is open — see notifyNewPosts in src/lib/push-notifications.ts.
 * A real background implementation needs a product decision about credential
 * custody first, and a privacy policy that matches it.
 */

export async function GET(request: Request) {
  // Verify this is an authorized cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO: List subscriptions from Blob, check for new notifications per user,
  // send push for each. This requires:
  // 1. npm install web-push
  // 2. Server-side credential storage for per-user notification polling
  // 3. const webpush = await import('web-push');
  //    webpush.setVapidDetails(email, publicKey, privateKey);
  // 4. For each subscription, fetch new notifications from AT Protocol / Mastodon
  // 5. Call webpush.sendNotification(subscription, JSON.stringify(payload))

  return new Response(JSON.stringify({ ok: true, message: 'Push cron executed' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
