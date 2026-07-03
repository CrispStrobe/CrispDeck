/**
 * Store / remove web push subscriptions.
 * Uses Vercel Blob for persistence (requires BLOB_READ_WRITE_TOKEN env var).
 */

export async function POST(request: Request) {
  const body = await request.json();
  const { subscription, userId } = body;

  if (!subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'Invalid subscription' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Dynamic import — @vercel/blob is only available in Vercel runtime
  try {
    const { put } = await import('@vercel/blob');
    const key = `push-subscriptions/${encodeURIComponent(userId || 'anonymous')}.json`;
    await put(key, JSON.stringify(subscription), {
      access: 'public',
      addRandomSuffix: false,
    });
  } catch (err: any) {
    // If Vercel Blob is not configured, log and return success anyway
    // (subscription was received, just not persisted)
    console.warn('Blob storage not available:', err?.message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE(request: Request) {
  const { userId } = await request.json();
  const key = `push-subscriptions/${encodeURIComponent(userId || 'anonymous')}.json`;

  try {
    const { del } = await import('@vercel/blob');
    await del(key);
  } catch {
    // Blob not configured — no-op
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
