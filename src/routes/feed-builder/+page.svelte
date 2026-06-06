<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, getBskyAgent, type ClientEntry } from '$lib/api/client-factory';
  import { normalizePost, sortPosts } from '$lib/api/unified';
  import { BlueskyClient } from '$lib/api/bluesky';
  import {
    createFeedDefinition, createRule, compileQuery, describeFeed,
    getRuleLabel, getRulePlaceholder, RULE_TYPES,
    listSavedFeeds, saveFeedDefinition, deleteFeedDefinition,
    type FeedDefinition, type FeedRule, type RuleType,
  } from '$lib/feed-builder';
  import { i18n } from '$lib/i18n.svelte';
  import Post from '$lib/components/Post.svelte';
  import type { UnifiedPost, Account } from '$lib/types';
  import type { Agent } from '@atproto/api';
  import {
    Wand2, Plus, Trash2, Play, Save, Loader2, X, Search,
    ChevronDown, Eye, EyeOff, Columns3, Copy, FileText, GripVertical,
  } from '@lucide/svelte';

  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let loading = $state(true);

  // Current feed being edited
  let feed: FeedDefinition = $state(createFeedDefinition());
  let showAddRule = $state(false);

  // Saved feeds list
  let savedFeeds: FeedDefinition[] = $state([]);
  let showSavedList = $state(false);

  // Preview state
  let previewPosts: UnifiedPost[] = $state([]);
  let previewLoading = $state(false);
  let previewError = $state('');
  let previewCursor: string | undefined = $state(undefined);

  // Compiled query (reactive)
  const compiledQuery = $derived(compileQuery(feed.rules));
  const feedDescription = $derived(describeFeed(feed.rules));

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      savedFeeds = listSavedFeeds();
    } catch (e) {
      previewError = String(e);
    } finally {
      loading = false;
    }
  });

  function addRule(type: RuleType) {
    feed.rules = [...feed.rules, createRule(type)];
    showAddRule = false;
  }

  function removeRule(id: string) {
    feed.rules = feed.rules.filter(r => r.id !== id);
  }

  function toggleRule(id: string) {
    feed.rules = feed.rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
  }

  function moveRule(id: string, direction: 'up' | 'down') {
    const idx = feed.rules.findIndex(r => r.id === id);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= feed.rules.length) return;
    const newRules = [...feed.rules];
    [newRules[idx], newRules[newIdx]] = [newRules[newIdx], newRules[idx]];
    feed.rules = newRules;
  }

  async function runPreview() {
    if (!compiledQuery.trim()) {
      previewError = 'Add at least one filter rule to preview.';
      return;
    }

    previewLoading = true;
    previewError = '';
    previewPosts = [];

    try {
      const bskyEntry = [...clientEntries.entries()]
        .find(([id]) => accounts.find(a => a.id === id)?.platform === 'bluesky')?.[1];

      if (!bskyEntry) {
        previewError = 'No Bluesky account connected. Add one in Settings.';
        return;
      }

      const agent = bskyEntry.oauthAgent ?? (bskyEntry.client as BlueskyClient).getAgent();
      const resp = await agent.api.app.bsky.feed.searchPosts({
        q: compiledQuery,
        limit: 30,
      });

      previewPosts = resp.data.posts.map(p => ({
        uri: p.uri,
        text: (p.record as any).text ?? '',
        author: {
          handle: p.author.handle,
          displayName: p.author.displayName,
          avatar: p.author.avatar,
        },
        createdAt: (p.record as any).createdAt ?? p.indexedAt,
        platform: 'bluesky' as const,
        likeCount: p.likeCount,
        repostCount: p.repostCount,
        replyCount: p.replyCount,
        isRepost: false,
        raw: p,
      }));
      previewCursor = resp.data.cursor;
    } catch (e) {
      previewError = String(e);
    } finally {
      previewLoading = false;
    }
  }

  function handleSave() {
    if (!feed.name.trim()) {
      feed.name = 'Untitled Feed';
    }
    saveFeedDefinition(feed);
    savedFeeds = listSavedFeeds();
  }

  function handleLoad(saved: FeedDefinition) {
    feed = { ...saved, rules: saved.rules.map(r => ({ ...r })) };
    showSavedList = false;
  }

  function handleDelete(id: string) {
    deleteFeedDefinition(id);
    savedFeeds = listSavedFeeds();
  }

  function handleDuplicate(saved: FeedDefinition) {
    const dup = createFeedDefinition(`${saved.name} (copy)`);
    dup.description = saved.description;
    dup.rules = saved.rules.map(r => ({ ...r, id: `rule-${Date.now()}-${Math.random().toString(36).slice(2)}` }));
    saveFeedDefinition(dup);
    savedFeeds = listSavedFeeds();
  }

  function handleNew() {
    feed = createFeedDefinition();
    previewPosts = [];
    previewError = '';
  }

  function addToDeck() {
    handleSave();
    // Add as a search-type deck column with the compiled query
    const saved = localStorage.getItem('crispdeck-deck-columns');
    const columns = saved ? JSON.parse(saved) : [];
    columns.push({
      id: `search-${Date.now()}`,
      title: feed.name || 'Custom Feed',
      type: 'search',
      query: compiledQuery,
    });
    localStorage.setItem('crispdeck-deck-columns', JSON.stringify(columns));
    alert(`"${feed.name}" added to your deck!`);
  }

  function copyQuery() {
    navigator.clipboard.writeText(compiledQuery);
  }

  // Media type options for has-media rule
  const mediaOptions = ['images', 'video', 'link'];

  // Common language codes
  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'ja', label: '日本語' },
    { code: 'pt', label: 'Português' },
    { code: 'zh', label: '中文' },
    { code: 'ko', label: '한국어' },
    { code: 'ar', label: 'العربية' },
    { code: 'it', label: 'Italiano' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'ru', label: 'Русский' },
  ];
</script>

<svelte:head><title>CrispDeck — {i18n.t.nav.feedBuilder}</title><meta name="description" content="Build custom Bluesky feeds visually" /></svelte:head>

<div class="p-6 max-w-6xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Wand2 size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.nav.feedBuilder}</h1>
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={() => showSavedList = !showSavedList}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <FileText size={14} />
        {i18n.t.feedBuilder.savedFeeds} ({savedFeeds.length})
      </button>
      <button
        onclick={handleNew}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--color-primary)] rounded-md hover:opacity-90 transition-opacity"
      >
        <Plus size={14} />
        {i18n.t.feedBuilder.newFeed}
      </button>
    </div>
  </div>

  <!-- Saved feeds drawer -->
  {#if showSavedList && savedFeeds.length > 0}
    <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <h3 class="text-sm font-semibold mb-3">{i18n.t.feedBuilder.savedFeeds}</h3>
      <div class="space-y-2">
        {#each savedFeeds as saved}
          <div class="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-md">
            <div class="flex-1 min-w-0 cursor-pointer" onclick={() => handleLoad(saved)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && handleLoad(saved)}>
              <span class="text-sm font-medium">{saved.name}</span>
              <span class="text-[10px] text-[var(--color-text-muted)] block truncate">{describeFeed(saved.rules)}</span>
            </div>
            <div class="flex items-center gap-1 ml-2">
              <button onclick={() => handleDuplicate(saved)} title="Duplicate" class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <Copy size={12} />
              </button>
              <button onclick={() => handleDelete(saved.id)} title="Delete" class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <Loader2 size={32} class="animate-spin text-[var(--color-primary)]" />
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left: Rule editor -->
      <div class="space-y-4">
        <!-- Feed name & description -->
        <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-3">
          <div>
            <label for="feed-name" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.feedBuilder.feedName}</label>
            <input
              id="feed-name"
              type="text"
              bind:value={feed.name}
              placeholder="My Custom Feed"
              class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label for="feed-desc" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.feedBuilder.description}</label>
            <input
              id="feed-desc"
              type="text"
              bind:value={feed.description}
              placeholder="What this feed shows..."
              class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        </div>

        <!-- Rules list -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">{i18n.t.feedBuilder.filterRules}</span>
            <span class="text-[10px] text-[var(--color-text-muted)]">{feed.rules.length} {feed.rules.length === 1 ? 'rule' : 'rules'}</span>
          </div>

          {#if feed.rules.length === 0}
            <div class="p-6 bg-[var(--color-surface)] rounded-lg border border-dashed border-[var(--color-border)] text-center">
              <p class="text-sm text-[var(--color-text-muted)] mb-3">{i18n.t.feedBuilder.noRulesHint}</p>
              <button
                onclick={() => showAddRule = true}
                class="px-4 py-2 text-sm bg-[var(--color-primary)] rounded-md hover:opacity-90 transition-opacity"
              >
                <Plus size={14} class="inline mr-1" />
                {i18n.t.feedBuilder.addFirstRule}
              </button>
            </div>
          {:else}
            {#each feed.rules as rule, idx (rule.id)}
              <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] {!rule.enabled ? 'opacity-50' : ''}">
                <div class="flex items-center gap-2 mb-2">
                  <GripVertical size={12} class="text-[var(--color-text-muted)] cursor-move" />
                  <span class="text-xs font-medium text-[var(--color-primary)] px-1.5 py-0.5 bg-[var(--color-primary)]/10 rounded">
                    {getRuleLabel(rule.type)}
                  </span>
                  <div class="flex-1"></div>
                  {#if idx > 0}
                    <button onclick={() => moveRule(rule.id, 'up')} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs px-1">↑</button>
                  {/if}
                  {#if idx < feed.rules.length - 1}
                    <button onclick={() => moveRule(rule.id, 'down')} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs px-1">↓</button>
                  {/if}
                  <button onclick={() => toggleRule(rule.id)} title="{rule.enabled ? 'Disable' : 'Enable'}" class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    {#if rule.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
                  </button>
                  <button onclick={() => removeRule(rule.id)} title="Remove" class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                    <Trash2 size={12} />
                  </button>
                </div>

                <!-- Rule value input -->
                {#if rule.type === 'language'}
                  <select
                    bind:value={rule.value}
                    class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
                  >
                    <option value="">Select language...</option>
                    {#each languageOptions as lang}
                      <option value={lang.code}>{lang.label} ({lang.code})</option>
                    {/each}
                  </select>
                {:else if rule.type === 'has-media'}
                  <select
                    bind:value={rule.value}
                    class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
                  >
                    <option value="">Select media type...</option>
                    {#each mediaOptions as opt}
                      <option value={opt}>{opt}</option>
                    {/each}
                  </select>
                {:else if rule.type === 'since' || rule.type === 'until'}
                  <input
                    type="date"
                    bind:value={rule.value}
                    class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
                  />
                {:else}
                  <input
                    type="text"
                    bind:value={rule.value}
                    placeholder={getRulePlaceholder(rule.type)}
                    class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                  />
                {/if}
              </div>
            {/each}
          {/if}

          <!-- Add rule button / menu -->
          <div class="relative">
            <button
              onclick={() => showAddRule = !showAddRule}
              class="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm border border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)] transition-colors"
            >
              <Plus size={14} />
              {i18n.t.feedBuilder.addRule}
            </button>

            {#if showAddRule}
              <div class="absolute left-0 right-0 top-full mt-1 z-20 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden">
                <div class="grid grid-cols-2 gap-0.5 p-1">
                  {#each RULE_TYPES as rt}
                    <button
                      onclick={() => addRule(rt.type)}
                      class="flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--color-surface-hover)] rounded-md transition-colors"
                    >
                      <span class="text-[var(--color-primary)]">{rt.label}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>

        <!-- Compiled query display -->
        {#if compiledQuery}
          <div class="p-3 bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">{i18n.t.feedBuilder.compiledQuery}</span>
              <button onclick={copyQuery} title="Copy query" class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <Copy size={12} />
              </button>
            </div>
            <code class="text-xs text-[var(--color-primary)] break-all">{compiledQuery}</code>
            <p class="text-[10px] text-[var(--color-text-muted)] mt-1">{feedDescription}</p>
          </div>
        {/if}

        <!-- Action buttons -->
        <div class="flex flex-wrap gap-2">
          <button
            onclick={runPreview}
            disabled={previewLoading || !compiledQuery.trim()}
            class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-bluesky)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {#if previewLoading}<Loader2 size={14} class="animate-spin" />{:else}<Play size={14} />{/if}
            {i18n.t.feedBuilder.preview}
          </button>
          <button
            onclick={handleSave}
            disabled={!feed.name.trim() && feed.rules.length === 0}
            class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {i18n.t.feedBuilder.save}
          </button>
          <button
            onclick={addToDeck}
            disabled={!compiledQuery.trim()}
            class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
          >
            <Columns3 size={14} />
            {i18n.t.feedBuilder.addToDeck}
          </button>
        </div>
      </div>

      <!-- Right: Preview -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">{i18n.t.feedBuilder.previewResults}</span>
          {#if previewPosts.length > 0}
            <span class="text-[10px] text-[var(--color-text-muted)]">{previewPosts.length} posts</span>
          {/if}
        </div>

        {#if previewError}
          <div class="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-300 mb-3">
            {previewError}
          </div>
        {/if}

        {#if previewLoading}
          <div class="flex items-center justify-center py-20">
            <Loader2 size={24} class="animate-spin text-[var(--color-bluesky)]" />
          </div>
        {:else if previewPosts.length === 0}
          <div class="p-8 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
            <Search size={32} class="text-[var(--color-text-muted)] mx-auto mb-3" />
            <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.feedBuilder.previewHint}</p>
          </div>
        {:else}
          <div class="space-y-3 max-h-[80vh] overflow-y-auto">
            {#each previewPosts as post}
              <Post {post} compact={true} />
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
