<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Tag, Loader2, Plus, X, Shield, Eye, EyeOff, AlertTriangle } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import type { Account } from '$lib/types';

  interface LabelerInfo {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
    description?: string;
    likeCount?: number;
    labelDefinitions: LabelDef[];
    isSubscribed: boolean;
  }

  interface LabelDef {
    identifier: string;
    blurs: 'content' | 'media' | 'none';
    severity: 'alert' | 'inform' | 'none';
    defaultSetting: 'hide' | 'warn' | 'ignore';
    locales?: Array<{ lang: string; name: string; description: string }>;
  }

  // User preference for each label
  type LabelPref = 'hide' | 'warn' | 'ignore';

  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let loading = $state(true);
  let error = $state('');
  let labelers: LabelerInfo[] = $state([]);
  let labelPrefs: Record<string, LabelPref> = $state({});

  // Search for labelers
  let searchQuery = $state('');
  let searchResults: LabelerInfo[] = $state([]);
  let searching = $state(false);

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadLabelers();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  function getAgent(): any {
    for (const entry of clientEntries.values()) {
      if (entry.platform === 'bluesky') {
        return entry.oauthAgent ?? (entry.client as BlueskyClient).getAgent();
      }
    }
    return null;
  }

  async function loadLabelers() {
    const agent = getAgent();
    if (!agent) return;

    try {
      // Get user preferences including labeler subscriptions
      const prefs = await agent.getPreferences();

      // Get subscribed labeler DIDs
      const subscribedDids: string[] = prefs.moderationPrefs?.labelers?.map((l: any) => l.did) ?? [];

      if (subscribedDids.length > 0) {
        // Fetch labeler details
        const resp = await agent.api.app.bsky.labeler.getServices({
          dids: subscribedDids,
          detailed: true,
        });

        labelers = (resp.data.views ?? []).map((view: any) => ({
          did: view.creator.did,
          handle: view.creator.handle,
          displayName: view.creator.displayName,
          avatar: view.creator.avatar,
          description: view.creator.description,
          likeCount: view.likeCount,
          labelDefinitions: (view.policies?.labelValueDefinitions ?? []).map((d: any) => ({
            identifier: d.identifier,
            blurs: d.blurs ?? 'none',
            severity: d.severity ?? 'none',
            defaultSetting: d.defaultSetting ?? 'warn',
            locales: d.locales,
          })),
          isSubscribed: true,
        }));
      }

      // Load label preferences
      const savedPrefs = localStorage.getItem('crispdeck-label-prefs');
      if (savedPrefs) labelPrefs = JSON.parse(savedPrefs);
    } catch (e) {
      console.error('Failed to load labelers:', e);
    }
  }

  async function searchLabelers() {
    if (!searchQuery.trim()) return;
    searching = true;
    try {
      const agent = getAgent();
      if (!agent) return;

      // Search for actors and check if they're labelers
      const actors = await agent.api.app.bsky.actor.searchActors({ term: searchQuery, limit: 10 });
      const results: LabelerInfo[] = [];

      for (const actor of actors.data.actors) {
        try {
          const resp = await agent.api.app.bsky.labeler.getServices({
            dids: [actor.did],
            detailed: true,
          });
          if (resp.data.views?.length > 0) {
            const view = resp.data.views[0] as any;
            results.push({
              did: view.creator.did,
              handle: view.creator.handle,
              displayName: view.creator.displayName,
              avatar: view.creator.avatar,
              description: view.creator.description,
              likeCount: view.likeCount,
              labelDefinitions: (view.policies?.labelValueDefinitions ?? []).map((d: any) => ({
                identifier: d.identifier,
                blurs: d.blurs ?? 'none',
                severity: d.severity ?? 'none',
                defaultSetting: d.defaultSetting ?? 'warn',
              })),
              isSubscribed: labelers.some(l => l.did === actor.did),
            });
          }
        } catch {}
      }
      searchResults = results;
    } catch (e) {
      error = String(e);
    } finally {
      searching = false;
    }
  }

  async function subscribeLabeler(labeler: LabelerInfo) {
    const agent = getAgent();
    if (!agent) return;
    try {
      // Add labeler to preferences
      const prefs = await agent.getPreferences();
      const currentLabelers = prefs.moderationPrefs?.labelers ?? [];
      if (!currentLabelers.some((l: any) => l.did === labeler.did)) {
        await agent.addLabeler(labeler.did);
      }
      labeler.isSubscribed = true;
      labelers = [...labelers, labeler];
      searchResults = searchResults.map(r => r.did === labeler.did ? { ...r, isSubscribed: true } : r);
    } catch (e) {
      error = String(e);
    }
  }

  async function unsubscribeLabeler(did: string) {
    const agent = getAgent();
    if (!agent) return;
    try {
      await agent.removeLabeler(did);
      labelers = labelers.filter(l => l.did !== did);
      searchResults = searchResults.map(r => r.did === did ? { ...r, isSubscribed: false } : r);
    } catch (e) {
      error = String(e);
    }
  }

  function setLabelPref(identifier: string, pref: LabelPref) {
    labelPrefs[identifier] = pref;
    labelPrefs = { ...labelPrefs };
    localStorage.setItem('crispdeck-label-prefs', JSON.stringify(labelPrefs));
  }

  function getLabelPref(def: LabelDef): LabelPref {
    return labelPrefs[def.identifier] ?? def.defaultSetting;
  }

  function getLabelName(def: LabelDef): string {
    const en = def.locales?.find(l => l.lang === 'en');
    return en?.name ?? def.identifier;
  }

  function getLabelDesc(def: LabelDef): string {
    const en = def.locales?.find(l => l.lang === 'en');
    return en?.description ?? '';
  }
</script>

<svelte:head><title>CrispDeck — Labelers</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Moderation tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/moderation" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Moderation</a>
    <a href="/labelers" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Labelers</a>
  </div>

  <div class="flex items-center gap-2 mb-6">
    <Tag size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.nav.labelers}</h1>
    <span class="text-xs px-2 py-0.5 bg-[var(--color-bluesky)]/20 text-[var(--color-bluesky)] rounded">Bluesky</span>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  <!-- Search for labelers -->
  <form onsubmit={(e) => { e.preventDefault(); searchLabelers(); }} class="mb-6">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search for labelers by name or handle..."
        class="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]"
      />
      <button type="submit" disabled={searching} class="px-4 py-2 bg-[var(--color-bluesky)] text-white text-sm rounded-lg disabled:opacity-50">
        {#if searching}<Loader2 size={14} class="animate-spin" />{:else}Search{/if}
      </button>
    </div>
  </form>

  <!-- Search results -->
  {#if searchResults.length > 0}
    <div class="mb-8">
      <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Search Results</h2>
      <div class="space-y-3">
        {#each searchResults as labeler}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                {#if labeler.avatar}
                  <img loading="lazy" src={labeler.avatar} alt="" class="w-10 h-10 rounded-full" />
                {/if}
                <div>
                  <h3 class="text-sm font-medium">{labeler.displayName || labeler.handle}</h3>
                  <p class="text-xs text-[var(--color-text-muted)]">@{labeler.handle}</p>
                  {#if labeler.description}
                    <p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{labeler.description}</p>
                  {/if}
                  <p class="text-[10px] text-[var(--color-text-muted)] mt-1">{labeler.labelDefinitions.length} label definitions</p>
                </div>
              </div>
              {#if labeler.isSubscribed}
                <button onclick={() => unsubscribeLabeler(labeler.did)} class="px-3 py-1 text-xs border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:border-red-500 hover:text-red-400">
                  Unsubscribe
                </button>
              {:else}
                <button onclick={() => subscribeLabeler(labeler)} class="px-3 py-1 text-xs bg-[var(--color-bluesky)] text-white rounded-md">
                  Subscribe
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if labelers.length === 0 && searchResults.length === 0}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Tag size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Labelers Subscribed</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Search for labelers to subscribe to content moderation services.</p>
    </div>
  {:else}
    <!-- Subscribed labelers -->
    <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">Subscribed Labelers ({labelers.length})</h2>
    <div class="space-y-4">
      {#each labelers as labeler}
        <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
          <!-- Labeler header -->
          <div class="flex items-start justify-between p-4">
            <div class="flex items-center gap-3">
              {#if labeler.avatar}
                <img loading="lazy" src={labeler.avatar} alt="" class="w-10 h-10 rounded-full" />
              {/if}
              <div>
                <h3 class="text-sm font-medium">{labeler.displayName || labeler.handle}</h3>
                <p class="text-xs text-[var(--color-text-muted)]">@{labeler.handle}</p>
              </div>
            </div>
            <button onclick={() => unsubscribeLabeler(labeler.did)} class="px-3 py-1 text-xs border border-[var(--color-border)] rounded-md text-[var(--color-text-muted)] hover:border-red-500 hover:text-red-400">
              Unsubscribe
            </button>
          </div>

          <!-- Label definitions with preferences -->
          {#if labeler.labelDefinitions.length > 0}
            <div class="border-t border-[var(--color-border)] px-4 py-3">
              <p class="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Label Preferences</p>
              <div class="space-y-2">
                {#each labeler.labelDefinitions as def}
                  {@const currentPref = getLabelPref(def)}
                  <div class="flex items-center justify-between py-1">
                    <div class="flex-1 min-w-0">
                      <span class="text-xs font-medium">{getLabelName(def)}</span>
                      {#if def.blurs !== 'none'}
                        <span class="ml-1 text-[9px] px-1 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">blurs {def.blurs}</span>
                      {/if}
                      {#if def.severity === 'alert'}
                        <span class="ml-1 text-[9px] px-1 py-0.5 bg-red-900/30 text-red-400 rounded">alert</span>
                      {/if}
                      {#if getLabelDesc(def)}
                        <p class="text-[10px] text-[var(--color-text-muted)] truncate">{getLabelDesc(def)}</p>
                      {/if}
                    </div>
                    <div class="flex items-center gap-0.5 bg-[var(--color-bg)] rounded-md p-0.5 ml-3">
                      <button
                        onclick={() => setLabelPref(def.identifier, 'hide')}
                        class="px-2 py-0.5 text-[10px] rounded transition-colors {currentPref === 'hide' ? 'bg-red-600 text-white' : 'text-[var(--color-text-muted)]'}"
                        title="Hide labeled content"
                      >Hide</button>
                      <button
                        onclick={() => setLabelPref(def.identifier, 'warn')}
                        class="px-2 py-0.5 text-[10px] rounded transition-colors {currentPref === 'warn' ? 'bg-yellow-600 text-white' : 'text-[var(--color-text-muted)]'}"
                        title="Show warning on labeled content"
                      >Warn</button>
                      <button
                        onclick={() => setLabelPref(def.identifier, 'ignore')}
                        class="px-2 py-0.5 text-[10px] rounded transition-colors {currentPref === 'ignore' ? 'bg-green-600 text-white' : 'text-[var(--color-text-muted)]'}"
                        title="Show labeled content normally"
                      >Show</button>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
