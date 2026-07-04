<script lang="ts">
  import { X, Send, Loader2, ImagePlus, PenSquare } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import { crosspostThread, graphemeLength, type PostResult, type ComposeOptions } from '$lib/compose/adapter';
  import { splitForPlatform } from '$lib/compose/thread';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl, isVideoFile } from '$lib/compose/media';
  import { toast } from '$lib/toast.svelte';
  import { logCrosspost } from '$lib/db';
  import type { Account, Platform, UnifiedPost } from '$lib/types';

  let {
    open = $bindable(false),
    replyToPost = null,
    quotePost = null,
    onposted,
  }: {
    open: boolean;
    replyToPost?: UnifiedPost | null;
    quotePost?: UnifiedPost | null;
    onposted?: () => void;
  } = $props();

  let accounts: Account[] = $state([]);
  let selectedAccountIds: number[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let loaded = $state(false);
  let posting = $state(false);
  let error = $state('');
  let text = $state('');
  let mediaFiles: File[] = $state([]);
  let mediaPreviews: string[] = $state([]);
  let altTexts: string[] = $state([]);
  let visibility = $state<'public' | 'unlisted' | 'private' | 'direct'>('public');
  let contentWarning = $state('');
  let showCW = $state(false);
  let videoUploadStatus = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  const selectedAccounts = $derived(accounts.filter(a => selectedAccountIds.includes(a.id)));
  const hasBsky = $derived(selectedAccounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(selectedAccounts.some(a => a.platform === 'mastodon'));
  const hasThreads = $derived(selectedAccounts.some(a => a.platform === 'threads'));
  const bskyLen = $derived(graphemeLength(text));
  const mastoLen = $derived(text.length);
  const threadsLen = $derived(text.length);
  const needsThread = $derived(
    (hasBsky && bskyLen > 300) || (hasMasto && mastoLen > 500) || (hasThreads && threadsLen > 500)
  );

  $effect(() => {
    if (open && !loaded) {
      loadAccounts();
    }
    if (open && replyToPost) {
      text = `@${replyToPost.author.handle} `;
    }
  });

  // Focus textarea when opening
  $effect(() => {
    if (open && loaded && textareaEl) {
      requestAnimationFrame(() => textareaEl?.focus());
    }
  });

  // Focus trap: Tab cycles within panel
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePost();
      return;
    }
    if (e.key === 'Tab' && panelEl) {
      const focusable = panelEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  async function loadAccounts() {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      selectedAccountIds = accounts.map(a => a.id);
      loaded = true;
    } catch (e) {
      error = String(e);
    }
  }

  function addMedia(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    for (const file of Array.from(input.files)) {
      if (mediaFiles.length >= 4) break;
      const err = validateMediaFile(file);
      if (err) { error = err; continue; }
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

  async function handlePost() {
    if (!text.trim() && mediaFiles.length === 0) return;
    if (selectedAccountIds.length === 0) {
      error = 'Select at least one account to post to.';
      return;
    }

    posting = true;
    error = '';

    const targets = selectedAccountIds
      .map(id => {
        const acct = accounts.find(a => a.id === id);
        const entry = clientEntries.get(id);
        if (!acct || !entry) return null;
        const plan = splitForPlatform(text.trim(), acct.platform as Platform);
        return { platform: acct.platform as Platform, client: entry.client, parts: plan.parts.map(p => p.text) };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Build quote options
    const quoteUri = quotePost?.uri;
    const quoteCid = (quotePost?.raw as any)?.post?.cid ?? (quotePost?.raw as any)?.cid ?? '';
    const quoteAuthor = quotePost?.author.handle ?? '';
    let quoteUrl: string | undefined;
    if (quoteUri && quoteAuthor) {
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
      onVideoProgress: (status: string) => { videoUploadStatus = status; },
    };

    try {
      const results = await crosspostThread(targets, options);
      const allSuccess = results.every(r => r.success);

      await logCrosspost({
        bluesky_uri: results.find(r => r.platform === 'bluesky')?.uri ?? null,
        bluesky_cid: results.find(r => r.platform === 'bluesky')?.cid ?? null,
        mastodon_uri: results.find(r => r.platform === 'mastodon')?.uri ?? null,
        mastodon_id: null,
        threads_uri: results.find(r => r.platform === 'threads')?.uri ?? null,
        threads_id: null,
        text_preview: text.trim().substring(0, 280),
        media_count: mediaFiles.length,
        status: allSuccess ? 'success' : results.some(r => r.success) ? 'partial' : 'failed',
      });

      if (allSuccess) {
        toast.success(`Posted to ${results.map(r => r.platform).join(' + ')}!`);
        resetForm();
        open = false;
        onposted?.();
      } else {
        const failed = results.filter(r => !r.success);
        const succeeded = results.filter(r => r.success);
        if (succeeded.length > 0) toast.warning(`Posted to ${succeeded.map(r => r.platform).join(', ')} but failed on ${failed.map(r => r.platform).join(', ')}`);
        else toast.error(`Post failed: ${failed[0]?.error || 'Unknown error'}`);
      }
    } catch (e) {
      error = String(e);
      toast.error('Post failed');
    } finally {
      posting = false;
      videoUploadStatus = '';
    }
  }

  function resetForm() {
    text = '';
    contentWarning = '';
    showCW = false;
    mediaPreviews.forEach(revokePreviewUrl);
    mediaFiles = [];
    mediaPreviews = [];
    altTexts = [];
    error = '';
  }

  function handleClose() {
    open = false;
  }
</script>

{#if open}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[90] bg-black/40 floating-compose-backdrop"
    onclick={handleClose}
    onkeydown={() => {}}
  ></div>

  <!-- Slide-in panel from right -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={panelEl}
    class="fixed top-0 right-0 z-[91] h-full w-full max-w-md bg-[var(--color-bg)] border-l border-[var(--color-border)] shadow-2xl flex flex-col floating-compose-panel"
    role="dialog"
    aria-modal="true"
    aria-label="Compose post"
    onkeydown={handleKeydown}
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex-shrink-0">
      <div class="flex items-center gap-2">
        <PenSquare size={16} />
        <span class="text-sm font-semibold">
          {#if replyToPost}
            {i18n.t.compose.replyingTo} @{replyToPost.author.handle}
          {:else if quotePost}
            {i18n.t.compose.quoting} @{quotePost.author.handle}
          {:else}
            {i18n.t.compose.title}
          {/if}
        </span>
      </div>
      <button onclick={handleClose} class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
        <X size={16} />
      </button>
    </div>

    {#if !loaded}
      <div class="flex-1 flex items-center justify-center">
        <Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin" />
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        {#if error}
          <div class="p-2 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-xs">
            {error}
            <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
          </div>
        {/if}

        <!-- Quote context preview -->
        {#if quotePost}
          <div class="p-2 bg-purple-950/30 border-l-4 border-purple-500 rounded-r-lg text-xs">
            <span class="text-purple-300">{i18n.t.compose.quoting}</span>
            <span class="font-medium text-purple-400 ml-1">@{quotePost.author.handle}</span>
            <p class="text-[var(--color-text-muted)] mt-1 line-clamp-2">{quotePost.text.substring(0, 100)}</p>
          </div>
        {/if}

        <!-- Content warning -->
        {#if showCW}
          <div class="flex items-center gap-2">
            <input type="text" bind:value={contentWarning} placeholder={i18n.t.compose.cwPlaceholder}
              class="flex-1 px-3 py-1.5 bg-[var(--color-bg)] border border-yellow-600 rounded-md text-xs text-[var(--color-text)] focus:outline-none" />
            <button onclick={() => { showCW = false; contentWarning = ''; }} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <X size={12} />
            </button>
          </div>
        {/if}

        <!-- Textarea -->
        <div class="relative">
          <textarea
            bind:this={textareaEl}
            bind:value={text}
            placeholder={i18n.t.compose.placeholder}
            rows="6"
            class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] {needsThread ? 'border-yellow-500/50' : ''}"
          ></textarea>
          <!-- Character count rings -->
          <div class="absolute bottom-2 right-2 flex items-center gap-2 text-[10px]">
            {#if hasBsky}
              {@const pct = Math.min(bskyLen / 300, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-bluesky)'}
              <span class="flex items-center gap-0.5 {pct >= 1 ? 'text-yellow-400' : pct >= 0.9 ? 'text-red-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="14" height="14" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round" transform="rotate(-90 9 9)" />
                </svg>
                {bskyLen}/300
              </span>
            {/if}
            {#if hasMasto}
              {@const pct = Math.min(mastoLen / 500, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-mastodon)'}
              <span class="flex items-center gap-0.5 {pct >= 1 ? 'text-yellow-400' : pct >= 0.9 ? 'text-red-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="14" height="14" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round" transform="rotate(-90 9 9)" />
                </svg>
                {mastoLen}/500
              </span>
            {/if}
            {#if hasThreads}
              {@const pct = Math.min(threadsLen / 500, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-threads, #888)'}
              <span class="flex items-center gap-0.5 {pct >= 1 ? 'text-yellow-400' : pct >= 0.9 ? 'text-red-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="14" height="14" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round" transform="rotate(-90 9 9)" />
                </svg>
                {threadsLen}/500
              </span>
            {/if}
          </div>
        </div>

        <!-- Media previews -->
        {#if mediaPreviews.length > 0}
          <div class="grid grid-cols-2 gap-2">
            {#each mediaPreviews as preview, i}
              <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                <div class="relative aspect-video">
                  {#if mediaFiles[i] && isVideoFile(mediaFiles[i])}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video src={preview} class="w-full h-full object-cover" muted></video>
                  {:else}
                    <img loading="lazy" src={preview} alt={altTexts[i] || ''} class="w-full h-full object-cover" />
                  {/if}
                  <button onclick={() => removeMedia(i)} class="absolute top-1 right-1 p-0.5 bg-black/70 rounded-full text-white hover:bg-black">
                    <X size={10} />
                  </button>
                </div>
                <input type="text" bind:value={altTexts[i]} placeholder={i18n.t.compose.altTextPlaceholder}
                  class="w-full px-2 py-1 bg-transparent border-t border-[var(--color-border)] text-[10px] text-[var(--color-text)] focus:outline-none" />
              </div>
            {/each}
          </div>
        {/if}

        <!-- Account picker -->
        <AccountPicker {accounts} bind:selected={selectedAccountIds} />
      </div>

      <!-- Bottom toolbar -->
      <div class="px-4 py-3 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex-shrink-0">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <label class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md cursor-pointer transition-colors {mediaFiles.length >= 4 ? 'opacity-50 pointer-events-none' : ''}">
              <ImagePlus size={16} />
              <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple class="hidden" onchange={addMedia} />
            </label>
            <EmojiPicker onselect={(emoji) => {
              if (textareaEl) {
                const pos = textareaEl.selectionStart;
                text = text.substring(0, pos) + emoji + text.substring(pos);
                requestAnimationFrame(() => { textareaEl?.focus(); const p = pos + emoji.length; textareaEl?.setSelectionRange(p, p); });
              } else { text += emoji; }
            }} />
            <button onclick={() => showCW = !showCW}
              class="px-1.5 py-0.5 text-[10px] font-mono border rounded transition-colors {showCW ? 'border-yellow-600 text-yellow-400' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}">
              CW
            </button>
            {#if hasMasto}
              <select bind:value={visibility}
                class="px-1.5 py-0.5 text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none">
                <option value="public">{i18n.t.compose.public}</option>
                <option value="unlisted">{i18n.t.compose.unlisted}</option>
                <option value="private">{i18n.t.compose.followersOnlyVis}</option>
                <option value="direct">{i18n.t.compose.direct}</option>
              </select>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            {#if videoUploadStatus}
              <span class="flex items-center gap-1 text-[10px] text-blue-300">
                <Loader2 size={10} class="animate-spin" />
                {videoUploadStatus}
              </span>
            {/if}
            <button
              onclick={handlePost}
              disabled={posting || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
              class="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors"
            >
              {#if posting}
                <Loader2 size={12} class="animate-spin" />
                {i18n.t.compose.posting}
              {:else}
                <Send size={12} />
                {needsThread ? 'Thread' : 'Post'}
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .floating-compose-backdrop {
    animation: fade-in 0.15s ease-out;
  }
  .floating-compose-panel {
    animation: slide-in-right 0.2s ease-out;
  }
  @keyframes slide-in-right {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
