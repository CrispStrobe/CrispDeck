<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { Bell, Heart, Repeat, UserPlus, MessageCircle, AtSign, Loader2, Quote } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account } from '$lib/types';

  interface UnifiedNotification {
    id: string;
    platform: 'bluesky' | 'mastodon';
    type: string;
    createdAt: string;
    author: { handle: string; displayName?: string; avatar?: string };
    text?: string;
    postUri?: string;
  }

  let accounts: Account[] = $state([]);
  let notifications: UnifiedNotification[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    try {
      accounts = await listAccounts();
      await initClients();
      await loadNotifications();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await getDecryptedCredentials(acct.id);
        const creds = JSON.parse(credsJson);
        if (acct.platform === 'bluesky') {
          const client = new BlueskyClient(acct.handle, creds.app_password);
          await client.login();
          clients.set(acct.id, client);
        } else {
          clients.set(acct.id, new MastodonClient(
            acct.instance_url ?? `https://${acct.handle.split('@').pop()}`,
            creds.access_token,
          ));
        }
      } catch (e) {
        console.error(`Failed to init client for ${acct.handle}:`, e);
      }
    }
  }

  async function loadNotifications() {
    const all: UnifiedNotification[] = [];

    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      try {
        if (acct.platform === 'bluesky') {
          const bsky = client as BlueskyClient;
          const { notifications: notifs } = await bsky.getNotifications();
          for (const n of notifs) {
            all.push({
              id: `bsky-${n.uri}`,
              platform: 'bluesky',
              type: n.reason, // like, repost, follow, mention, reply, quote
              createdAt: n.indexedAt,
              author: {
                handle: n.author.handle,
                displayName: n.author.displayName,
                avatar: n.author.avatar,
              },
              text: (n.record as any)?.text,
              postUri: n.reasonSubject,
            });
          }
        } else {
          const masto = client as MastodonClient;
          const token = masto.getAccessToken();
          if (!token) continue;
          const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/notifications?limit=40`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.ok) {
            const raw = await resp.json();
            for (const n of raw) {
              all.push({
                id: `masto-${n.id}`,
                platform: 'mastodon',
                type: n.type, // mention, status, reblog, follow, favourite, poll, update
                createdAt: n.created_at,
                author: {
                  handle: n.account?.acct ? `@${n.account.acct}` : '?',
                  displayName: n.account?.display_name,
                  avatar: n.account?.avatar,
                },
                text: n.status?.content?.replace(/<[^>]*>?/gm, ''),
                postUri: n.status?.uri,
              });
            }
          }
        }
      } catch (e) {
        console.error(`Failed to load notifications for ${acct.handle}:`, e);
      }
    }

    notifications = all.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  function getIcon(type: string) {
    switch (type) {
      case 'like': case 'favourite': return Heart;
      case 'repost': case 'reblog': return Repeat;
      case 'follow': return UserPlus;
      case 'mention': return AtSign;
      case 'reply': return MessageCircle;
      case 'quote': return Quote;
      default: return Bell;
    }
  }

  function getColor(type: string): string {
    switch (type) {
      case 'like': case 'favourite': return 'text-red-400';
      case 'repost': case 'reblog': return 'text-green-400';
      case 'follow': return 'text-blue-400';
      case 'mention': case 'reply': return 'text-yellow-400';
      case 'quote': return 'text-purple-400';
      default: return 'text-[var(--color-text-muted)]';
    }
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Bell size={24} />
    <h1 class="text-2xl font-bold">Notifications</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if notifications.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Bell size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Notifications</h3>
      <p class="text-sm text-[var(--color-text-muted)]">
        {accounts.length === 0 ? 'Add accounts in Settings first.' : 'Nothing new yet.'}
      </p>
    </div>
  {:else}
    <div class="space-y-1">
      {#each notifications as notif (notif.id)}
        {@const Icon = getIcon(notif.type)}
        <div class="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--color-surface)] transition-colors">
          <div class="flex-shrink-0 mt-0.5 {getColor(notif.type)}">
            <Icon size={16} />
          </div>
          <div class="flex items-start gap-2 flex-1 min-w-0">
            {#if notif.author.avatar}
              <a href="/profile?handle={encodeURIComponent(notif.author.handle)}&platform={notif.platform}">
                <img src={notif.author.avatar} alt="" class="w-8 h-8 rounded-full flex-shrink-0" />
              </a>
            {/if}
            <div class="flex-1 min-w-0">
              <p class="text-sm">
                <a href="/profile?handle={encodeURIComponent(notif.author.handle)}&platform={notif.platform}" class="font-semibold hover:underline">
                  {notif.author.displayName || notif.author.handle}
                </a>
                <span class="text-[var(--color-text-muted)]">
                  {#if notif.type === 'like' || notif.type === 'favourite'}liked your post
                  {:else if notif.type === 'repost' || notif.type === 'reblog'}boosted your post
                  {:else if notif.type === 'follow'}followed you
                  {:else if notif.type === 'mention'}mentioned you
                  {:else if notif.type === 'reply'}replied
                  {:else if notif.type === 'quote'}quoted your post
                  {:else}{notif.type}
                  {/if}
                </span>
              </p>
              {#if notif.text}
                <p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{notif.text}</p>
              {/if}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="w-2 h-2 rounded-full" style="background: {notif.platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"></span>
            <span class="text-[10px] text-[var(--color-text-muted)]">{formatTime(notif.createdAt)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
