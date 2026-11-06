import type { MastodonClient } from '$lib/api/mastodon';

/** Mastodon status IDs are instance-local, even when the post URI is global. */
export async function resolveMastodonReply(client: MastodonClient, reply: { uri: string; id?: string }): Promise<string> {
  if (!reply.uri && reply.id) return reply.id; // A preceding part created on this client.
  let canonical: URL;
  try { canonical = new URL(reply.uri); }
  catch { throw new Error('The Mastodon reply target has no valid post URL.'); }
  if (!['https:', 'http:'].includes(canonical.protocol) || canonical.username || canonical.password) throw new Error('The Mastodon reply target has no valid post URL.');
  const instance = client.getInstanceUrl();
  const token = client.getAccessToken();
  if (!token) throw new Error('Reconnect the Mastodon account before replying.');
  const options: RequestInit = { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' };
  const matches = (status: { id?: string; uri?: string; url?: string }) => !!status.id && (status.uri === reply.uri || status.url === reply.uri);
  if (reply.id) {
    const response = await fetch(`${instance}/api/v1/statuses/${encodeURIComponent(reply.id)}`, options);
    if (response.ok) {
      const status = await response.json();
      if (matches(status)) return status.id;
    } else if (response.status !== 404) {
      throw new Error(`Could not verify the Mastodon reply target (${response.status}).`);
    }
  }
  // Resolve on the destination instance; a URI suffix from another server may
  // name an unrelated post here. Authenticate only to the selected instance.
  const params = new URLSearchParams({ q: reply.uri, type: 'statuses', resolve: 'true', limit: '5' });
  const response = await fetch(`${instance}/api/v2/search?${params}`, options);
  if (!response.ok) throw new Error(`Could not resolve the Mastodon reply target (${response.status}).`);
  const body = await response.json();
  const status = Array.isArray(body.statuses) ? body.statuses.find(matches) : undefined;
  if (!status) throw new Error('The post being replied to is unavailable on this Mastodon account.');
  return status.id;
}
