<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Bell, Heart, Repeat, UserPlus, MessageCircle, AtSign, Loader2, Quote, ChevronDown, ChevronUp, RefreshCw, CheckCheck } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account } from '$lib/types';
  import { groupNotifications, type UnifiedNotification, type NotificationGroup } from '$lib/notification-grouping';
  import { getCached, setCache } from '$lib/view-cache';
  import SkeletonNotification from '$lib/components/SkeletonNotification.svelte';

  let accounts: Account[] = $state([]);
  let groups: NotificationGroup[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let refreshing = $state(false);
  let expandedGroups: Set<string> = $state(new Set());

  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    // Show cached notifications instantly
    const cached = getCached<NotificationGroup[]>('notifications');
    if (cached) { groups = cached.data; loading = false; }

    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadNotifications();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadNotifications() {
    const all: UnifiedNotification[] = [];

    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      try {
        if (acct.platform === 'bluesky') {
          const bsky = entry.client as BlueskyClient;
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
          const masto = entry.client as MastodonClient;
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

    groups = groupNotifications(all);
    setCache('notifications', groups);
  }

  async function refresh() {
    refreshing = true;
    await loadNotifications();
    refreshing = false;
  }

  function toggleGroup(groupId: string) {
    const next = new Set(expandedGroups);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    expandedGroups = next;
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
    if (diff < 60000) return i18n.t.notifications.justNow;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getActionText(type: string, count: number): string {
    if (count === 1) {
      switch (type) {
        case 'like': return i18n.t.notifications.liked;
        case 'repost': return i18n.t.notifications.boosted;
        case 'follow': return i18n.t.notifications.followed;
        case 'mention': return i18n.t.notifications.mentioned;
        case 'reply': return i18n.t.notifications.replied;
        case 'quote': return i18n.t.notifications.quoted;
        default: return type;
      }
    }
    // Grouped — use the grouped i18n strings
    switch (type) {
      case 'like': return i18n.t.notifications.likedGroup.replace('{count}', String(count));
      case 'repost': return i18n.t.notifications.boostedGroup.replace('{count}', String(count));
      case 'follow': return i18n.t.notifications.followedGroup.replace('{count}', String(count));
      default: return type;
    }
  }

  /** Max avatars to show inline before "+N more" */
  const MAX_AVATARS = 5;
</script>

<svelte:head><title>CrispDeck — Notifications</title><meta name="description" content="Unified notifications from all your accounts" /></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Bell size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.notifications.title}</h1>
    </div>
    {#if groups.length > 0}
      <div class="flex items-center gap-2">
        <button
          onclick={refresh}
          disabled={refreshing}
          class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} class={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          onclick={() => groups = []}
          class="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
          title="Clear all"
        >
          <CheckCheck size={14} />
          Clear
        </button>
      </div>
    {/if}
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="space-y-1">
      {#each { length: 8 } as _}
        <SkeletonNotification />
      {/each}
    </div>
  {:else if groups.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Bell size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.notifications.noNotifications}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">
        {accounts.length === 0 ? i18n.t.notifications.addAccountsFirst : i18n.t.notifications.nothingNew}
      </p>
    </div>
  {:else}
    <div class="space-y-1">
      {#each groups as group (group.id)}
        {@const Icon = getIcon(group.type)}
        {@const isGrouped = group.actors.length > 1}
        {@const isExpanded = expandedGroups.has(group.id)}
        <div class="rounded-lg hover:bg-[var(--color-surface)] transition-colors">
          <!-- Main notification row -->
          <div class="flex items-start gap-3 p-3">
            <div class="flex-shrink-0 mt-0.5 {getColor(group.type)}">
              <Icon size={16} />
            </div>
            <div class="flex items-start gap-2 flex-1 min-w-0">
              <!-- Avatar stack for grouped, single avatar otherwise -->
              <div class="flex items-center flex-shrink-0">
                {#if isGrouped}
                  <div class="flex -space-x-2">
                    {#each group.actors.slice(0, MAX_AVATARS) as actor}
                      {#if actor.avatar}
                        <a href="/profile?handle={encodeURIComponent(actor.handle)}&platform={actor.platform}" title={actor.displayName || actor.handle}>
                          <img loading="lazy" src={actor.avatar} alt="" class="w-7 h-7 rounded-full border-2 border-[var(--color-bg)]" />
                        </a>
                      {/if}
                    {/each}
                    {#if group.actors.length > MAX_AVATARS}
                      <span class="w-7 h-7 rounded-full bg-[var(--color-surface)] border-2 border-[var(--color-bg)] flex items-center justify-center text-[9px] font-bold text-[var(--color-text-muted)]">
                        +{group.actors.length - MAX_AVATARS}
                      </span>
                    {/if}
                  </div>
                {:else if group.actors[0]?.avatar}
                  <a href="/profile?handle={encodeURIComponent(group.actors[0].handle)}&platform={group.actors[0].platform}">
                    <img loading="lazy" src={group.actors[0].avatar} alt="" class="w-8 h-8 rounded-full flex-shrink-0" />
                  </a>
                {/if}
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm">
                  {#if isGrouped}
                    <!-- Grouped: show first actor name + "and N others" -->
                    <a href="/profile?handle={encodeURIComponent(group.actors[0].handle)}&platform={group.actors[0].platform}" class="font-semibold hover:underline">
                      {group.actors[0].displayName || group.actors[0].handle}
                    </a>
                    <span class="text-[var(--color-text-muted)]">
                      {getActionText(group.type, group.actors.length)}
                    </span>
                    <!-- Expand/collapse toggle -->
                    <button
                      onclick={() => toggleGroup(group.id)}
                      class="inline-flex items-center ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {#if isExpanded}
                        <ChevronUp size={12} />
                      {:else}
                        <ChevronDown size={12} />
                      {/if}
                    </button>
                  {:else}
                    <!-- Single notification -->
                    <a href="/profile?handle={encodeURIComponent(group.actors[0].handle)}&platform={group.actors[0].platform}" class="font-semibold hover:underline">
                      {group.actors[0].displayName || group.actors[0].handle}
                    </a>
                    <span class="text-[var(--color-text-muted)]">
                      {getActionText(group.type, 1)}
                    </span>
                  {/if}
                </p>
                {#if group.text}
                  <p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{group.text}</p>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              {#if group.platforms.size === 1}
                <span class="w-2 h-2 rounded-full" style="background: var(--color-{[...group.platforms][0]})"></span>
              {:else}
                <!-- Both platforms -->
                <span class="flex -space-x-1">
                  <span class="w-2 h-2 rounded-full" style="background: var(--color-bluesky)"></span>
                  <span class="w-2 h-2 rounded-full" style="background: var(--color-mastodon)"></span>
                </span>
              {/if}
              <span class="text-[10px] text-[var(--color-text-muted)]">{formatTime(group.latestAt)}</span>
            </div>
          </div>

          <!-- Expanded actor list -->
          {#if isGrouped && isExpanded}
            <div class="pl-10 pr-3 pb-3 space-y-1">
              {#each group.actors as actor}
                <a
                  href="/profile?handle={encodeURIComponent(actor.handle)}&platform={actor.platform}"
                  class="flex items-center gap-2 p-1.5 rounded hover:bg-[var(--color-bg)] transition-colors"
                >
                  {#if actor.avatar}
                    <img loading="lazy" src={actor.avatar} alt="" class="w-5 h-5 rounded-full" />
                  {/if}
                  <span class="text-xs font-medium">{actor.displayName || actor.handle}</span>
                  <span class="text-[10px] text-[var(--color-text-muted)]">@{actor.handle}</span>
                  <span class="w-1.5 h-1.5 rounded-full ml-auto" style="background: var(--color-{actor.platform})"></span>
                </a>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
