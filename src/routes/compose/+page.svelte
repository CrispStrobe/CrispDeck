<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { PenSquare, Send, Loader2, X, ImagePlus, AlertTriangle, Check } from '@lucide/svelte';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { crosspost, getCharLimit, graphemeLength, type PostResult, type ComposeOptions } from '$lib/compose/adapter';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl } from '$lib/compose/media';
  import type { Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let selectedAccountIds: number[] = $state([]);
  let loading = $state(true);
  let posting = $state(false);
  let error = $state('');
  let results: PostResult[] = $state([]);

  // Compose state
  let text = $state('');
  let visibility = $state<'public' | 'unlisted' | 'private' | 'direct'>('public');
  let contentWarning = $state('');
  let showCW = $state(false);
  let mediaFiles: File[] = $state([]);
  let mediaPreviews: string[] = $state([]);

  // Clients
  let clients: Map<number, BlueskyClient | MastodonClient> = new Map();

  onMount(async () => {
    try {
      accounts = await invoke<Account[]>('db_list_accounts');
      selectedAccountIds = accounts.map(a => a.id);
      await initClients();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function initClients() {
    for (const acct of accounts) {
      try {
        const credsJson = await invoke<string>('db_get_credentials', { id: acct.id });
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

  function addMedia(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    for (const file of Array.from(input.files)) {
      if (mediaFiles.length >= 4) break;
      const err = validateMediaFile(file);
      if (err) {
        error = err;
        continue;
      }
      mediaFiles = [...mediaFiles, file];
      mediaPreviews = [...mediaPreviews, createPreviewUrl(file)];
    }
    input.value = '';
  }

  function removeMedia(index: number) {
    revokePreviewUrl(mediaPreviews[index]);
    mediaFiles = mediaFiles.filter((_, i) => i !== index);
    mediaPreviews = mediaPreviews.filter((_, i) => i !== index);
  }

  async function handlePost() {
    if (!text.trim() && mediaFiles.length === 0) return;
    if (selectedAccountIds.length === 0) {
      error = 'Select at least one account to post to.';
      return;
    }

    posting = true;
    error = '';
    results = [];

    const targets = selectedAccountIds
      .map(id => {
        const acct = accounts.find(a => a.id === id);
        const client = clients.get(id);
        if (!acct || !client) return null;
        return { platform: acct.platform as 'bluesky' | 'mastodon', client };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const options: ComposeOptions = {
      text: text.trim(),
      visibility,
      contentWarning: showCW ? contentWarning : undefined,
      mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
    };

    try {
      results = await crosspost(targets, options);

      // Log to crosspost history
      const bskyResult = results.find(r => r.platform === 'bluesky');
      const mastoResult = results.find(r => r.platform === 'mastodon');
      const allSuccess = results.every(r => r.success);

      await invoke('db_log_crosspost', {
        bluesky_uri: bskyResult?.uri ?? null,
        bluesky_cid: bskyResult?.cid ?? null,
        mastodon_uri: mastoResult?.uri ?? null,
        mastodon_id: null,
        text_preview: text.trim().substring(0, 280),
        media_count: mediaFiles.length,
        status: allSuccess ? 'success' : results.some(r => r.success) ? 'partial' : 'failed',
      });

      // Clear on full success
      if (allSuccess) {
        text = '';
        contentWarning = '';
        showCW = false;
        mediaPreviews.forEach(revokePreviewUrl);
        mediaFiles = [];
        mediaPreviews = [];
      }
    } catch (e) {
      error = String(e);
    } finally {
      posting = false;
    }
  }

  async function saveDraft() {
    if (!text.trim()) return;
    try {
      await invoke('db_save_draft', {
        text: text.trim(),
        target_accounts: selectedAccountIds,
        visibility,
        content_warning: showCW ? contentWarning : null,
      });
      error = '';
      results = [{ platform: 'bluesky', success: true, uri: 'Draft saved' }];
    } catch (e) {
      error = `Failed to save draft: ${e}`;
    }
  }

  // Character counts per selected platform
  const selectedAccounts = $derived(accounts.filter(a => selectedAccountIds.includes(a.id)));
  const hasBsky = $derived(selectedAccounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(selectedAccounts.some(a => a.platform === 'mastodon'));
  const bskyLen = $derived(graphemeLength(text));
  const mastoLen = $derived(text.length);
  const bskyOver = $derived(hasBsky && bskyLen > 300);
  const mastoOver = $derived(hasMasto && mastoLen > 500);
  const isOverLimit = $derived(bskyOver || mastoOver);
</script>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <PenSquare size={24} />
    <h1 class="text-2xl font-bold">Compose</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if results.length > 0}
    <div class="mb-4 space-y-2">
      {#each results as result}
        <div class="p-3 rounded-lg text-sm flex items-center gap-2 {result.success ? 'bg-green-900/50 border border-green-700 text-green-200' : 'bg-red-900/50 border border-red-700 text-red-200'}">
          {#if result.success}
            <Check size={14} />
            <span>Posted to {result.platform}</span>
            {#if result.uri}
              <a href={result.uri} target="_blank" rel="noopener noreferrer" class="underline ml-1">View</a>
            {/if}
          {:else}
            <AlertTriangle size={14} />
            <span>{result.platform}: {result.error}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Main editor -->
      <div class="lg:col-span-2 space-y-4">
        <!-- Content warning -->
        {#if showCW}
          <div class="flex items-center gap-2">
            <input
              type="text"
              bind:value={contentWarning}
              placeholder="Content warning..."
              class="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-yellow-600 rounded-md text-sm text-[var(--color-text)] focus:outline-none"
            />
            <button onclick={() => { showCW = false; contentWarning = ''; }} class="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          </div>
        {/if}

        <!-- Text area -->
        <div class="relative">
          <textarea
            bind:value={text}
            placeholder="What's on your mind?"
            rows="8"
            class="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] {isOverLimit ? 'border-red-500' : ''}"
          ></textarea>

          <!-- Character counts -->
          <div class="absolute bottom-3 right-3 flex items-center gap-3 text-xs">
            {#if hasBsky}
              <span class="{bskyOver ? 'text-red-400 font-bold' : 'text-[var(--color-text-muted)]'}">
                <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-bluesky)] mr-1"></span>
                {bskyLen}/300
              </span>
            {/if}
            {#if hasMasto}
              <span class="{mastoOver ? 'text-red-400 font-bold' : 'text-[var(--color-text-muted)]'}">
                <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-mastodon)] mr-1"></span>
                {mastoLen}/500
              </span>
            {/if}
          </div>
        </div>

        <!-- Media -->
        {#if mediaPreviews.length > 0}
          <div class="grid grid-cols-4 gap-2">
            {#each mediaPreviews as preview, i}
              <div class="relative aspect-square rounded-lg overflow-hidden bg-[var(--color-surface-hover)]">
                <img src={preview} alt="" class="w-full h-full object-cover" />
                <button
                  onclick={() => removeMedia(i)}
                  class="absolute top-1 right-1 p-1 bg-black/70 rounded-full text-white hover:bg-black"
                >
                  <X size={12} />
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Toolbar -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <label class="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md cursor-pointer transition-colors {mediaFiles.length >= 4 ? 'opacity-50 pointer-events-none' : ''}">
              <ImagePlus size={18} />
              <input type="file" accept="image/*" multiple class="hidden" onchange={addMedia} />
            </label>
            <button
              onclick={() => showCW = !showCW}
              class="px-2 py-1 text-xs font-mono border rounded-md transition-colors {showCW ? 'border-yellow-600 text-yellow-400' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
            >
              CW
            </button>

            {#if hasMasto}
              <select
                bind:value={visibility}
                class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none"
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Followers only</option>
                <option value="direct">Direct</option>
              </select>
            {/if}
          </div>

          <div class="flex items-center gap-2">
            <button
              onclick={saveDraft}
              disabled={!text.trim()}
              class="px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
            >
              Save Draft
            </button>
            <button
              onclick={handlePost}
              disabled={posting || isOverLimit || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
              class="flex items-center gap-2 px-5 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
            >
              {#if posting}
                <Loader2 size={14} class="animate-spin" />
                Posting...
              {:else}
                <Send size={14} />
                Post{selectedAccountIds.length > 1 ? ` to ${selectedAccountIds.length} accounts` : ''}
              {/if}
            </button>
          </div>
        </div>
      </div>

      <!-- Sidebar: Account picker -->
      <div class="space-y-4">
        <AccountPicker {accounts} bind:selected={selectedAccountIds} />

        <!-- Platform preview hints -->
        {#if text.trim()}
          <div class="space-y-2">
            <span class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Preview</span>
            {#if hasBsky}
              <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div class="flex items-center gap-2 mb-2">
                  <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span>
                  <span class="text-xs font-medium text-[var(--color-text-muted)]">Bluesky</span>
                </div>
                <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{text}</p>
              </div>
            {/if}
            {#if hasMasto}
              <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div class="flex items-center gap-2 mb-2">
                  <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span>
                  <span class="text-xs font-medium text-[var(--color-text-muted)]">Mastodon</span>
                  {#if visibility !== 'public'}
                    <span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] rounded text-[var(--color-text-muted)]">{visibility}</span>
                  {/if}
                </div>
                {#if showCW && contentWarning}
                  <p class="text-xs text-yellow-400 mb-1">⚠ {contentWarning}</p>
                {/if}
                <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{text}</p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
