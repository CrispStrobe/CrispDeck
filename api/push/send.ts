/**
 * Cron job endpoint for sending web push notifications.
 *
 * Called every 2 minutes by Vercel Cron. For each stored subscription,
 * checks for new notifications and sends push messages via VAPID.
 *
 * Requires env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, CRON_SECRET
 */
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@crispdeck.vercel.app';

export async function GET(request: Request) {
  // Verify this is an authorized cron request
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // TODO: List subscriptions from Blob, check for new notifications per user,
  // send push for each. This requires server-side credential storage which
  // is a separate feature. For now, this endpoint validates the VAPID setup.
  //
  // Future implementation:
  // 1. const { list } = await import('@vercel/blob');
  // 2. const blobs = await list({ prefix: 'push-subscriptions/' });
  // 3. For each subscription, fetch new notifications from AT Protocol / Mastodon
  // 4. Call webpush.sendNotification(subscription, JSON.stringify(payload))

  return new Response(JSON.stringify({ ok: true, message: 'Push cron executed' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
