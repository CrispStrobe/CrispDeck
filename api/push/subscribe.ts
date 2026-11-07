import { corsFor, preflight, safeError } from '../_lib/cors.js';
import { HttpError, readJsonObject } from '../_lib/request.js';
/**
 * Background delivery is not implemented. Do not collect subscription secrets
 * (particularly into public blobs) for a service that cannot send notifications.
 * DELETE only removes legacy storage when the caller proves possession of the
 * exact browser subscription, instead of trusting an arbitrary userId.
 */

export function POST(request: Request) {
  return new Response(JSON.stringify({ error: 'Background web push is not available. Notifications work while CrispDeck is open.' }), {
    status: 501,
    headers: { ...corsFor(request, 'POST, DELETE, OPTIONS'), 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: Request) {
  try {
    const { userId = 'anonymous', subscription } = await readJsonObject(request);
    if (typeof userId !== 'string' || !/^[a-zA-Z0-9._:@-]{1,256}$/.test(userId) || !isSubscription(subscription)) {
      throw new HttpError(400, 'The current browser subscription is required');
    }
    const key = `push-subscriptions/${encodeURIComponent(userId)}.json`;
    const { del, get } = await import('@vercel/blob');
    const blob = await get(key, { access: 'public', abortSignal: AbortSignal.timeout(5_000) });
    if (blob?.statusCode === 200) {
      const stored = await readJsonObject(new Response(blob.stream));
      if (!isSubscription(stored) || stored.endpoint !== subscription.endpoint ||
          stored.keys.auth !== subscription.keys.auth || stored.keys.p256dh !== subscription.keys.p256dh) {
        throw new HttpError(403, 'The stored subscription belongs to a different browser');
      }
      await del(key);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsFor(request, 'POST, DELETE, OPTIONS') });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof HttpError ? e.message : safeError('Removing the push subscription', e) }), {
      status: e instanceof HttpError ? e.status : 500,
      headers: { ...corsFor(request, 'POST, DELETE, OPTIONS'), 'Cache-Control': 'no-store' },
    });
  }
}

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
function isSubscription(value: unknown): value is Subscription {
  if (!value || typeof value !== 'object') return false;
  const sub = value as Partial<Subscription>;
  return typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') && sub.endpoint.length <= 4096 &&
    typeof sub.keys?.auth === 'string' && sub.keys.auth.length > 0 && sub.keys.auth.length <= 256 &&
    typeof sub.keys.p256dh === 'string' && sub.keys.p256dh.length > 0 && sub.keys.p256dh.length <= 256;
}

export function OPTIONS(request: Request) {
  return preflight(request, 'POST, DELETE, OPTIONS');
}
