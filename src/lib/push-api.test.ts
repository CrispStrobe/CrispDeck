// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, DELETE } from '../../api/push/subscribe';
import { GET as vapidKey } from '../../api/push/vapid-key';
import { GET as send } from '../../api/push/send';

const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock('@vercel/blob', () => blob);
const subscription = { endpoint: 'https://push.example/subscription-secret', keys: { p256dh: 'public-key', auth: 'auth-secret' } };
const request = (method = 'POST', body: unknown = { userId: 'default', subscription }) => new Request('https://crispdeck.vercel.app/api/push/subscribe', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  blob.put.mockReset();
  blob.get.mockReset().mockResolvedValue(null);
  blob.del.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', '');
  vi.stubEnv('VAPID_PUBLIC_KEY', 'configured-public-key');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'configured-private-key');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('unfinished web push fails closed', () => {
  it('does not collect or persist subscription secrets even with VAPID keys configured', async () => {
    expect(POST(request()).status).toBe(501);
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.get).not.toHaveBeenCalled();
  });

  it('does not advertise readiness or provide a key for a nonexistent sender', async () => {
    const response = vapidKey(new Request('https://crispdeck.vercel.app/api/push/vapid-key'));
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ configured: false });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([undefined, '', 'Bearer undefined', 'Bearer '])('never authenticates an unconfigured cron using %s', async (authorization) => {
    const response = await send(new Request('https://crispdeck.vercel.app/api/push/send', { headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(503);
  });

  it('rejects incorrect cron authentication', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-cron-secret');
    expect((await send(new Request('https://crispdeck.vercel.app/api/push/send', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
  });

  it('reports not implemented instead of pretending it sent notifications', async () => {
    vi.stubEnv('CRON_SECRET', 'configured-cron-secret');
    const response = await send(new Request('https://crispdeck.vercel.app/api/push/send', { headers: { authorization: 'Bearer configured-cron-secret' } }));
    expect(response.status).toBe(501);
    expect(await response.json()).not.toHaveProperty('ok', true);
  });
});

describe('legacy subscription cleanup', () => {
  it.each([null, [], { userId: 'default' }, { userId: '../feeds/victim', subscription }])('rejects absent proof or malformed input %j', async (body) => {
    expect((await DELETE(request('DELETE', body))).status).toBe(400);
    expect(blob.del).not.toHaveBeenCalled();
    expect(blob.get).not.toHaveBeenCalled();
  });

  it('returns a controlled error for malformed JSON', async () => {
    expect((await DELETE(new Request('https://crispdeck.vercel.app/api/push/subscribe', { method: 'DELETE', body: '{broken' }))).status).toBe(400);
  });

  it('requires the exact stored subscription before deleting a legacy blob', async () => {
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response(JSON.stringify(subscription)).body });
    expect((await DELETE(request('DELETE'))).status).toBe(200);
    expect(blob.del).toHaveBeenCalledExactlyOnceWith('push-subscriptions/default.json');
  });

  it.each([
    { ...subscription, endpoint: 'https://push.example/someone-else' },
    { ...subscription, keys: { ...subscription.keys, auth: 'different-auth' } },
    { ...subscription, keys: { ...subscription.keys, p256dh: 'different-key' } },
  ])('does not delete a different subscription %j', async (stored) => {
    blob.get.mockResolvedValue({ statusCode: 200, stream: new Response(JSON.stringify(stored)).body });
    expect((await DELETE(request('DELETE'))).status).toBe(403);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('allows browser revocation when there is no corresponding stored subscription', async () => {
    expect((await DELETE(request('DELETE'))).status).toBe(200);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it('does not report deletion success if storage is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    blob.get.mockRejectedValue(new Error('storage unavailable'));
    expect((await DELETE(request('DELETE'))).status).toBe(500);
  });
});
