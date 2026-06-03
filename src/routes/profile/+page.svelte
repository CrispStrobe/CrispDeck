<script lang="ts">
  import { onMount } from 'svelte';
  import { listAccounts, getDecryptedCredentials } from '$lib/db';
  import { User, Loader2, UserPlus, UserMinus, Ban, ArrowLeft } from '@lucide/svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account, Platform } from '$lib/types';

  let loading = $state(true);
  let error = $state('');
  let profile: any = $state(null);
  let posts: UnifiedPost[] = $state([]);
  let platform: Platform = $state('bluesky');
  let handle = $state('');
  let activeTab: 'posts' | 'replies' | 'media' | 'followers' | 'following' = $state('posts');
  let followersList: Array<{ handle: string; displayName?: string; avatar?: string }> = $state([]);
  let followingList: Array<{ handle: string; displayName?: string; avatar?: string }> = $state([]);
  let loadingFollows = $state(false);
  let following = $state(false);

  let accounts: Account[] = $state([]);
  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    handle = params.get('handle') ?? '';
    platform = (params.get('platform') as Platform) ?? 'bluesky';

    if (!handle) {
      error = 'No handle specified. Use ?handle=user.bsky.social&platform=bluesky';
      loading = false;
      return;
    }

    try {
      accounts = await listAccounts();
      await initClients();
      await loadProfile();
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

  function getClient(): BlueskyClient | MastodonClient | null {
    for (const [id, client] of clients) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.platform === platform) return client;
    }
    return null;
  }

  async function loadProfile() {
    const client = getClient();
    if (!client && platform === 'bluesky') {
      // Use read-only client for public profiles
      const readOnly = BlueskyClient.readOnly(handle);
      profile = await readOnly.getProfile(handle);
      const { feed } = await readOnly.getAuthorFeed(handle);
      posts = sortPosts(feed.map(p => normalizePost(p, 'bluesky')), 'newest');
      return;
    }
    if (!client) {
      error = `No ${platform} account connected`;
      return;
    }

    if (platform === 'bluesky') {
      const bsky = client as BlueskyClient;
      profile = await bsky.getProfile(handle);
      following = !!profile.viewer?.following;
      const { feed } = await bsky.getAuthorFeed(handle);
      posts = sortPosts(feed.map(p => normalizePost(p, 'bluesky')), 'newest');
    } else {
      const masto = client as MastodonClient;
      const account = await masto.getAccountByHandle(handle);
      profile = {
        handle: `@${account.acct}`,
        displayName: account.displayName,
        avatar: account.avatar,
        banner: account.header,
        description: account.note?.replace(/<[^>]*>?/gm, ''),
        followersCount: account.followersCount,
        followsCount: account.followingCount,
        postsCount: account.statusesCount,
        _mastodonId: account.id,
      };
      const statuses = await masto.getAccountStatuses(account.id);
      posts = sortPosts(statuses.map(s => normalizePost(s, 'mastodon')), 'newest');
    }
  }

  async function toggleFollow() {
    const client = getClient();
    if (!client) return;
    try {
      if (platform === 'bluesky') {
        // Bluesky follow/unfollow via agent
        const bsky = client as BlueskyClient;
        if (following) {
          // unfollow — need the follow record URI
          if (profile.viewer?.following) {
            await bsky.getAgent().deleteFollow(profile.viewer.following);
          }
        } else {
          await bsky.getAgent().follow(profile.did);
        }
      } else {
        const masto = client as MastodonClient;
        const token = masto.getAccessToken();
        const instanceUrl = masto.getInstanceUrl();
        if (token && profile._mastodonId) {
          const endpoint = following ? 'unfollow' : 'follow';
          await fetch(`${instanceUrl}/api/v1/accounts/${profile._mastodonId}/${endpoint}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      following = !following;
    } catch (e) {
      error = `Follow action failed: ${e}`;
    }
  }

  async function loadFollowTab(tab: 'followers' | 'following') {
    activeTab = tab;
    if ((tab === 'followers' && followersList.length > 0) || (tab === 'following' && followingList.length > 0)) return;
    loadingFollows = true;
    const client = getClient();
    try {
      if (platform === 'bluesky') {
        const bsky = (client as BlueskyClient) ?? BlueskyClient.readOnly(handle);
        if (tab === 'followers') {
          const resp = await bsky.getFollowers(handle);
          followersList = resp.followers.map((f: any) => ({ handle: f.handle, displayName: f.displayName, avatar: f.avatar }));
        } else {
          const resp = await bsky.getFollows(handle);
          followingList = resp.follows.map((f: any) => ({ handle: f.handle, displayName: f.displayName, avatar: f.avatar }));
        }
      } else if (platform === 'mastodon' && profile._mastodonId) {
        const masto = client as MastodonClient;
        const endpoint = tab === 'followers' ? 'followers' : 'following';
        const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/accounts/${profile._mastodonId}/${endpoint}?limit=80`);
        if (resp.ok) {
          const data = await resp.json();
          const list = data.map((a: any) => ({ handle: `@${a.acct}`, displayName: a.display_name, avatar: a.avatar }));
          if (tab === 'followers') followersList = list;
          else followingList = list;
        }
      }
    } catch (e) { error = String(e); }
    loadingFollows = false;
  }

  async function blockUser() {
    const client = getClient();
    if (!client) return;
    try {
      if (platform === 'bluesky' && profile.did) {
        await (client as BlueskyClient).getAgent().api.app.bsky.graph.muteActor({ actor: profile.did });
      } else if (platform === 'mastodon' && profile._mastodonId) {
        const masto = client as MastodonClient;
        const token = masto.getAccessToken();
        if (token) {
          await fetch(`${masto.getInstanceUrl()}/api/v1/accounts/${profile._mastodonId}/block`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      error = 'User blocked.';
    } catch (e) { error = String(e); }
  }

  async function muteUser() {
    const client = getClient();
    if (!client) return;
    try {
      if (platform === 'bluesky' && profile.did) {
        await (client as BlueskyClient).getAgent().api.app.bsky.graph.muteActor({ actor: profile.did });
      } else if (platform === 'mastodon' && profile._mastodonId) {
        const masto = client as MastodonClient;
        const token = masto.getAccessToken();
        if (token) {
          await fetch(`${masto.getInstanceUrl()}/api/v1/accounts/${profile._mastodonId}/mute`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      error = 'User muted.';
    } catch (e) { error = String(e); }
  }

  const filteredPosts = $derived(() => {
    switch (activeTab) {
      case 'replies': return posts.filter(p => p.replyParentUri);
      case 'media': return posts.filter(p => p.embeds && (Array.isArray(p.embeds) ? (p.embeds as any[]).length > 0 : true));
      default: return posts.filter(p => !p.replyParentUri);
    }
  });
</script>

<div class="p-6 max-w-3xl mx-auto">
  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
    <a href="/feed" class="flex items-center gap-1 text-sm text-[var(--color-primary)]"><ArrowLeft size={14} /> Back to feed</a>
  {:else if profile}
    <!-- Banner -->
    {#if profile.banner}
      <div class="h-32 rounded-t-lg bg-cover bg-center -mx-6 -mt-6 mb-4" style="background-image: url({profile.banner})"></div>
    {/if}

    <!-- Profile header -->
    <div class="flex items-start gap-4 mb-6">
      {#if profile.avatar}
        <img src={profile.avatar} alt="" class="w-20 h-20 rounded-full border-4 border-[var(--color-bg)] {profile.banner ? '-mt-12' : ''}" />
      {:else}
        <div class="w-20 h-20 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-2xl">
          <User size={32} />
        </div>
      {/if}
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold">{profile.displayName || handle}</h1>
            <p class="text-sm text-[var(--color-text-muted)]">
              {profile.handle ?? handle}
              <span class="inline-block w-2 h-2 rounded-full ml-1" style="background: {platform === 'bluesky' ? 'var(--color-bluesky)' : 'var(--color-mastodon)'}"></span>
            </p>
          </div>
          <button
            onclick={toggleFollow}
            class="flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-md transition-colors {following
              ? 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-red-500 hover:text-red-400'
              : 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'}"
          >
            {#if following}<UserMinus size={14} /> Following{:else}<UserPlus size={14} /> Follow{/if}
          </button>
          <button onclick={muteUser} class="px-3 py-2 text-xs border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-yellow-400 hover:border-yellow-500 transition-colors" title="Mute">Mute</button>
          <button onclick={blockUser} class="px-3 py-2 text-xs border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:text-red-400 hover:border-red-500 transition-colors" title="Block">Block</button>
        </div>
        {#if profile.description}
          <p class="text-sm text-[var(--color-text)] mt-2">{profile.description}</p>
        {/if}
        <div class="flex items-center gap-4 mt-3 text-sm">
          <span><strong>{profile.followersCount?.toLocaleString() ?? '?'}</strong> <span class="text-[var(--color-text-muted)]">followers</span></span>
          <span><strong>{profile.followsCount?.toLocaleString() ?? profile.followingCount?.toLocaleString() ?? '?'}</strong> <span class="text-[var(--color-text-muted)]">following</span></span>
          <span><strong>{profile.postsCount?.toLocaleString() ?? '?'}</strong> <span class="text-[var(--color-text-muted)]">posts</span></span>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 border-b border-[var(--color-border)] mb-4">
      {#each ['posts', 'replies', 'media'] as tab}
        <button
          onclick={() => activeTab = tab as typeof activeTab}
          class="px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px {activeTab === tab
            ? 'border-[var(--color-primary)] text-[var(--color-text)]'
            : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >
          {tab}
        </button>
      {/each}
      <button
        onclick={() => loadFollowTab('followers')}
        class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {activeTab === 'followers'
          ? 'border-[var(--color-primary)] text-[var(--color-text)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
      >
        Followers
      </button>
      <button
        onclick={() => loadFollowTab('following')}
        class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {activeTab === 'following'
          ? 'border-[var(--color-primary)] text-[var(--color-text)]'
          : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
      >
        Following
      </button>
    </div>

    <!-- Content based on active tab -->
    {#if activeTab === 'followers' || activeTab === 'following'}
      {@const list = activeTab === 'followers' ? followersList : followingList}
      {#if loadingFollows}
        <div class="text-center py-8"><Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
      {:else if list.length === 0}
        <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No {activeTab} found.</p>
      {:else}
        <div class="space-y-1">
          {#each list as user}
            <a href="/profile?handle={encodeURIComponent(user.handle)}&platform={platform}" class="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors">
              {#if user.avatar}
                <img src={user.avatar} alt="" class="w-9 h-9 rounded-full" />
              {:else}
                <div class="w-9 h-9 rounded-full bg-[var(--color-surface-hover)]"></div>
              {/if}
              <div>
                <p class="text-sm font-medium">{user.displayName || user.handle}</p>
                <p class="text-xs text-[var(--color-text-muted)]">{user.handle}</p>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    {:else}
      <!-- Posts -->
      <div class="space-y-3">
        {#each filteredPosts() as post (post.uri)}
          <Post {post} />
        {/each}
        {#if filteredPosts().length === 0}
          <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">No {activeTab} to show.</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>
