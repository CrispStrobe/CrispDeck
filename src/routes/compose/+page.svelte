<script lang="ts">
  import { onMount } from 'svelte';
  import { logCrosspost, saveDraft as dbSaveDraft, listDrafts, deleteDraft as dbDeleteDraft } from '$lib/db';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { PenSquare, Send, Loader2, X, ImagePlus, AlertTriangle, Check, BarChart3, Shield } from '@lucide/svelte';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import MentionAutocomplete from '$lib/components/MentionAutocomplete.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import GifPicker from '$lib/components/GifPicker.svelte';
  import { listTemplates, saveTemplate, deleteTemplate, type PostTemplate } from '$lib/templates';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { crosspostThread, graphemeLength, type PostResult, type ComposeOptions, type ThreadGate, type PollOptions } from '$lib/compose/adapter';
  import { splitForPlatform, planThread, type ThreadPlan } from '$lib/compose/thread';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl } from '$lib/compose/media';
  import type { Account, Platform } from '$lib/types';

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

  // Reply context
  let replyTo = $state('');
  let replyAuthor = $state('');
  let replyPlatform = $state('');
  let editingDraftId: number | null = $state(null);

  // Templates
  let templates: PostTemplate[] = $state([]);
  let showTemplates = $state(false);

  // Thread gate (Bluesky)
  let threadGate: ThreadGate = $state('everyone');

  // Poll (Mastodon)
  let showPoll = $state(false);
  let pollOptions = $state(['', '']);
  let pollExpiry = $state(86400); // 24h default
  let pollMultiple = $state(false);

  // Quote context
  let quoteUri = $state('');
  let quoteCid = $state('');
  let quoteAuthor = $state('');
  let quoteText = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let mentionAutocomplete: MentionAutocomplete | undefined = $state();
  let mediaPreviews: string[] = $state([]);
  let altTexts: string[] = $state([]);

  // Clients
  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      selectedAccountIds = accounts.map(a => a.id);

      // Handle URL params: ?replyTo=...&author=...&platform=... or ?draft=ID
      const params = new URLSearchParams(window.location.search);

      // Resume editing a draft
      const draftId = params.get('draft');
      if (draftId) {
        const drafts = await listDrafts();
        const draft = drafts.find(d => d.id === Number(draftId));
        if (draft) {
          text = draft.text;
          visibility = (draft.visibility as typeof visibility) ?? 'public';
          contentWarning = draft.content_warning ?? '';
          showCW = !!draft.content_warning;
          const ids = Array.isArray(draft.target_accounts)
            ? draft.target_accounts
            : JSON.parse(draft.target_accounts as unknown as string);
          selectedAccountIds = ids;
          editingDraftId = draft.id;
        }
      }

      // Reply context
      replyTo = params.get('replyTo') ?? '';
      replyAuthor = params.get('author') ?? '';
      replyPlatform = params.get('platform') ?? '';
      if (replyAuthor && !text) {
        text = `@${replyAuthor} `;
      }

      // Quote context
      quoteUri = params.get('quoteUri') ?? '';
      quoteCid = params.get('quoteCid') ?? '';
      quoteAuthor = params.get('quoteAuthor') ?? '';
      quoteText = params.get('quoteText') ?? '';
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      templates = listTemplates();
    }
  });

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
      altTexts = [...altTexts, ''];
    }
    input.value = '';
  }

  function removeMedia(index: number) {
    revokePreviewUrl(mediaPreviews[index]);
    mediaFiles = mediaFiles.filter((_, i) => i !== index);
    mediaPreviews = mediaPreviews.filter((_, i) => i !== index);
    altTexts = altTexts.filter((_, i) => i !== index);
  }

  function checkAltText(): boolean {
    if (mediaFiles.length === 0) return true;
    const mode = localStorage.getItem('crispdeck-alt-text-mode') ?? 'off';
    if (mode === 'off') return true;
    const missingAlt = altTexts.some((t, i) => i < mediaFiles.length && !t.trim());
    if (!missingAlt) return true;
    if (mode === 'require') {
      error = 'Alt text is required for all images. Add descriptions before posting.';
      return false;
    }
    if (mode === 'warn') {
      return confirm('Some images are missing alt text. Post anyway?');
    }
    return true;
  }

  async function handlePost() {
    if (!text.trim() && mediaFiles.length === 0) return;
    if (selectedAccountIds.length === 0) {
      error = 'Select at least one account to post to.';
      return;
    }
    if (!checkAltText()) return;

    posting = true;
    error = '';
    results = [];

    const targets = selectedAccountIds
      .map(id => {
        const acct = accounts.find(a => a.id === id);
        const entry = clientEntries.get(id);
        if (!acct || !entry) return null;
        // Split text per platform's char limits
        const plan = splitForPlatform(text.trim(), acct.platform as Platform);
        return {
          platform: acct.platform as 'bluesky' | 'mastodon',
          client: entry.client,
          parts: plan.parts.map(p => p.text),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Build quote URL for Mastodon (Bluesky uses embed record)
    let quoteUrl: string | undefined;
    if (quoteUri && quoteAuthor) {
      // Construct a bsky.app URL for the quoted post
      const rkey = quoteUri.split('/').pop();
      quoteUrl = `https://bsky.app/profile/${quoteAuthor}/post/${rkey}`;
    }

    const options: Omit<ComposeOptions, 'text'> = {
      visibility,
      contentWarning: showCW ? contentWarning : undefined,
      mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
      altTexts: altTexts.length > 0 ? altTexts : undefined,
      quoteUri: quoteUri || undefined,
      quoteCid: quoteCid || undefined,
      quoteUrl,
      threadGate: threadGate !== 'everyone' ? threadGate : undefined,
      poll: showPoll && pollOptions.filter(o => o.trim()).length >= 2
        ? { options: pollOptions.filter(o => o.trim()), expiresIn: pollExpiry, multiple: pollMultiple }
        : undefined,
    };

    try {
      results = await crosspostThread(targets, options);

      // Log to crosspost history
      const bskyResult = results.find(r => r.platform === 'bluesky');
      const mastoResult = results.find(r => r.platform === 'mastodon');
      const allSuccess = results.every(r => r.success);

      await logCrosspost({
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
        altTexts = [];
      }
    } catch (e) {
      error = String(e);
    } finally {
      posting = false;
    }
  }

  async function handleSaveDraft() {
    if (!text.trim()) return;
    try {
      await dbSaveDraft({
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
  async function addGif(gif: { url: string; preview: string; width: number; height: number; title: string }) {
    if (mediaFiles.length >= 4) return;
    try {
      const resp = await fetch(gif.url);
      const blob = await resp.blob();
      const file = new File([blob], `gif-${Date.now()}.gif`, { type: 'image/gif' });
      mediaFiles = [...mediaFiles, file];
      mediaPreviews = [...mediaPreviews, createPreviewUrl(file)];
      altTexts = [...altTexts, gif.title];
    } catch (e) {
      error = `Failed to load GIF: ${e}`;
    }
  }

  const altTextEnforced = typeof localStorage !== 'undefined' && (localStorage.getItem('crispdeck-alt-text-mode') ?? 'off') !== 'off';

  const selectedAccounts = $derived(accounts.filter(a => selectedAccountIds.includes(a.id)));
  const hasBsky = $derived(selectedAccounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(selectedAccounts.some(a => a.platform === 'mastodon'));
  const bskyLen = $derived(graphemeLength(text));
  const mastoLen = $derived(text.length);
  const bskyNeedsThread = $derived(hasBsky && bskyLen > 300);
  const mastoNeedsThread = $derived(hasMasto && mastoLen > 500);
  const needsThread = $derived(bskyNeedsThread || mastoNeedsThread);
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
        <!-- Reply context -->
        {#if replyTo}
          <div class="p-3 bg-blue-950/30 border-l-4 border-blue-500 rounded-r-lg text-sm">
            <span class="text-blue-300">Replying to</span>
            <a href="/profile?handle={encodeURIComponent(replyAuthor)}&platform={replyPlatform}" class="font-medium text-blue-400 hover:underline ml-1">@{replyAuthor}</a>
          </div>
        {/if}

        <!-- Quote context -->
        {#if quoteUri}
          <div class="p-3 bg-purple-950/30 border-l-4 border-purple-500 rounded-r-lg text-sm">
            <span class="text-purple-300">Quoting</span>
            <span class="font-medium text-purple-400 ml-1">@{quoteAuthor}</span>
            {#if quoteText}
              <p class="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{quoteText}</p>
            {/if}
          </div>
        {/if}

        <!-- Editing draft indicator -->
        {#if editingDraftId}
          <div class="p-2 bg-yellow-950/30 border border-yellow-700/30 rounded-lg text-xs text-yellow-300 flex items-center justify-between">
            <span>Editing draft #{editingDraftId}</span>
            <button onclick={async () => { await dbDeleteDraft(editingDraftId!); editingDraftId = null; }} class="text-yellow-400 hover:text-yellow-200 underline">Discard draft</button>
          </div>
        {/if}

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

        <!-- Text area with mention autocomplete -->
        <div class="relative">
          <textarea
            bind:this={textareaEl}
            bind:value={text}
            placeholder="What's on your mind? Type @ to mention someone..."
            rows="8"
            oninput={() => mentionAutocomplete?.handleInput()}
            onkeydown={(e) => {
              mentionAutocomplete?.handleKeydown(e);
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handlePost(); }
            }}
            class="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] {needsThread ? 'border-yellow-500/50' : ''}"
          ></textarea>
          <MentionAutocomplete bind:this={mentionAutocomplete} textarea={textareaEl} bind:text />

          <!-- Character counts with warning thresholds -->
          <div class="absolute bottom-3 right-3 flex items-center gap-3 text-xs">
            {#if hasBsky}
              {@const pct = bskyLen / 300}
              <span class="{pct >= 1 ? 'text-yellow-400 font-bold' : pct >= 0.9 ? 'text-red-400' : pct >= 0.8 ? 'text-orange-400' : 'text-[var(--color-text-muted)]'}">
                <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-bluesky)] mr-1"></span>
                {bskyLen}/300{bskyNeedsThread ? ' →thread' : ''}
              </span>
            {/if}
            {#if hasMasto}
              {@const pct = mastoLen / 500}
              <span class="{pct >= 1 ? 'text-yellow-400 font-bold' : pct >= 0.9 ? 'text-red-400' : pct >= 0.8 ? 'text-orange-400' : 'text-[var(--color-text-muted)]'}">
                <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-mastodon)] mr-1"></span>
                {mastoLen}/500{mastoNeedsThread ? ' →thread' : ''}
              </span>
            {/if}
          </div>
        </div>

        <!-- Media with alt text -->
        {#if mediaPreviews.length > 0}
          <div class="grid grid-cols-2 gap-3">
            {#each mediaPreviews as preview, i}
              <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                <div class="relative aspect-video">
                  <img src={preview} alt={altTexts[i] || ''} class="w-full h-full object-cover" />
                  <button
                    onclick={() => removeMedia(i)}
                    class="absolute top-1 right-1 p-1 bg-black/70 rounded-full text-white hover:bg-black"
                  >
                    <X size={12} />
                  </button>
                </div>
                <input
                  type="text"
                  bind:value={altTexts[i]}
                  placeholder="Describe this image for accessibility..."
                  class="w-full px-2 py-1.5 bg-transparent border-t text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none {altTextEnforced && !altTexts[i]?.trim() ? 'border-yellow-500 bg-yellow-950/20' : 'border-[var(--color-border)]'}"
                />
              </div>
            {/each}
          </div>
        {/if}

        <!-- Toolbar -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <label class="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md cursor-pointer transition-colors {mediaFiles.length >= 4 ? 'opacity-50 pointer-events-none' : ''}">
              <ImagePlus size={18} />
              <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple class="hidden" onchange={addMedia} />
            </label>
            <GifPicker onselect={addGif} />
            <EmojiPicker onselect={(emoji) => {
              if (textareaEl) {
                const pos = textareaEl.selectionStart;
                text = text.substring(0, pos) + emoji + text.substring(pos);
                requestAnimationFrame(() => {
                  textareaEl?.focus();
                  const newPos = pos + emoji.length;
                  textareaEl?.setSelectionRange(newPos, newPos);
                });
              } else {
                text += emoji;
              }
            }} />
            <button
              onclick={() => showCW = !showCW}
              class="px-2 py-1 text-xs font-mono border rounded-md transition-colors {showCW ? 'border-yellow-600 text-yellow-400' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
            >
              CW
            </button>

            <!-- Templates -->
            <div class="relative">
              <button
                onclick={() => showTemplates = !showTemplates}
                class="px-2 py-1 text-xs border rounded-md transition-colors {showTemplates ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
              >
                Tpl
              </button>
              {#if showTemplates}
                <div class="absolute bottom-full left-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 w-56 max-h-48 overflow-y-auto py-1">
                  <button
                    onclick={() => { saveTemplate({ name: text.trim().substring(0, 30) || 'Untitled', text: text.trim(), visibility, contentWarning: showCW ? contentWarning : undefined }); templates = listTemplates(); showTemplates = false; }}
                    disabled={!text.trim()}
                    class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
                  >
                    + Save current as template
                  </button>
                  {#if templates.length > 0}
                    <div class="border-t border-[var(--color-border)] my-1"></div>
                    {#each templates as tpl}
                      <div class="flex items-center justify-between px-3 py-1.5 hover:bg-[var(--color-surface-hover)]">
                        <button
                          onclick={() => { text = tpl.text; if (tpl.visibility) visibility = tpl.visibility as any; if (tpl.contentWarning) { contentWarning = tpl.contentWarning; showCW = true; } showTemplates = false; }}
                          class="flex-1 text-left text-xs truncate"
                        >
                          {tpl.name}
                        </button>
                        <button onclick={() => { deleteTemplate(tpl.id); templates = listTemplates(); }} class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] ml-1">
                          <X size={10} />
                        </button>
                      </div>
                    {/each}
                  {:else}
                    <p class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">No templates saved</p>
                  {/if}
                </div>
              {/if}
            </div>

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

              <button
                onclick={() => showPoll = !showPoll}
                class="p-1.5 rounded-md transition-colors {showPoll ? 'text-[var(--color-mastodon)] bg-[var(--color-mastodon)]/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
                title="Add poll (Mastodon)"
              >
                <BarChart3 size={14} />
              </button>
            {/if}

            {#if hasBsky}
              <select
                bind:value={threadGate}
                class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none"
                title="Who can reply (Bluesky)"
              >
                <option value="everyone">Anyone can reply</option>
                <option value="mentioned">Mentioned only</option>
                <option value="following">Followers only</option>
                <option value="nobody">No replies</option>
              </select>
            {/if}
          </div>

          <div class="flex items-center gap-2">
            <button
              onclick={handleSaveDraft}
              disabled={!text.trim()}
              class="px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
            >
              Save Draft
            </button>
            <button
              onclick={handlePost}
              disabled={posting || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
              class="flex items-center gap-2 px-5 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
            >
              {#if posting}
                <Loader2 size={14} class="animate-spin" />
                Posting...
              {:else}
                <Send size={14} />
                {needsThread ? 'Post Thread' : 'Post'}{selectedAccountIds.length > 1 ? ` to ${selectedAccountIds.length} accounts` : ''}
              {/if}
            </button>
          </div>
        </div>

        <!-- Poll creator (Mastodon only) -->
        {#if showPoll && hasMasto}
          <div class="p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-mastodon)]/30">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-medium text-[var(--color-mastodon)] flex items-center gap-1">
                <BarChart3 size={12} /> Poll (Mastodon)
              </span>
              <button onclick={() => showPoll = false} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X size={12} />
              </button>
            </div>
            <div class="space-y-2">
              {#each pollOptions as _, i}
                <input
                  type="text"
                  bind:value={pollOptions[i]}
                  placeholder="Option {i + 1}"
                  class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-mastodon)]"
                />
              {/each}
              {#if pollOptions.length < 4}
                <button
                  onclick={() => pollOptions = [...pollOptions, '']}
                  class="text-xs text-[var(--color-mastodon)] hover:underline"
                >
                  + Add option
                </button>
              {/if}
            </div>
            <div class="flex items-center gap-4 mt-3 text-xs">
              <label class="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                <input type="checkbox" bind:checked={pollMultiple} class="rounded" />
                Multiple choice
              </label>
              <select
                bind:value={pollExpiry}
                class="px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              >
                <option value={3600}>1 hour</option>
                <option value={21600}>6 hours</option>
                <option value={86400}>24 hours</option>
                <option value={259200}>3 days</option>
                <option value={604800}>7 days</option>
              </select>
            </div>
          </div>
        {/if}
      </div>

      <!-- Sidebar: Account picker -->
      <div class="space-y-4">
        <AccountPicker {accounts} bind:selected={selectedAccountIds} />

        <!-- Platform preview with thread splitting -->
        {#if text.trim()}
          <div class="space-y-2">
            <span class="text-xs text-[var(--color-text-muted)] uppercase tracking-wider font-medium">Preview</span>
            {#if hasBsky}
              {@const bskyPlan = splitForPlatform(text.trim(), 'bluesky')}
              <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-[var(--color-bluesky)]"></span>
                    <span class="text-xs font-medium text-[var(--color-text-muted)]">Bluesky</span>
                  </div>
                  {#if bskyPlan.needsThread}
                    <span class="text-[10px] px-1.5 py-0.5 bg-blue-900/50 rounded text-blue-300">{bskyPlan.parts.length} posts</span>
                  {/if}
                </div>
                {#each bskyPlan.parts as part, i}
                  <div class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words {i > 0 ? 'mt-2 pt-2 border-t border-[var(--color-border)]' : ''}">
                    {part.text}
                    <span class="text-[10px] text-[var(--color-text-muted)] ml-1">{part.charCount}/{part.charLimit}</span>
                  </div>
                {/each}
              </div>
            {/if}
            {#if hasMasto}
              {@const mastoPlan = splitForPlatform(text.trim(), 'mastodon')}
              <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-[var(--color-mastodon)]"></span>
                    <span class="text-xs font-medium text-[var(--color-text-muted)]">Mastodon</span>
                    {#if visibility !== 'public'}
                      <span class="text-[10px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] rounded text-[var(--color-text-muted)]">{visibility}</span>
                    {/if}
                  </div>
                  {#if mastoPlan.needsThread}
                    <span class="text-[10px] px-1.5 py-0.5 bg-purple-900/50 rounded text-purple-300">{mastoPlan.parts.length} posts</span>
                  {/if}
                </div>
                {#if showCW && contentWarning}
                  <p class="text-xs text-yellow-400 mb-1">⚠ {contentWarning}</p>
                {/if}
                {#each mastoPlan.parts as part, i}
                  <div class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words {i > 0 ? 'mt-2 pt-2 border-t border-[var(--color-border)]' : ''}">
                    {part.text}
                    <span class="text-[10px] text-[var(--color-text-muted)] ml-1">{part.charCount}/{part.charLimit}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
