<script lang="ts">
  import { X, Send, Loader2, ImagePlus, PenSquare } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import { graphemeLength } from '$lib/compose/adapter';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl, isVideoFile } from '$lib/compose/media';
  import { toast } from '$lib/toast.svelte';
  import { onDestroy } from 'svelte';
  import { snapshot, saveSnapshot, loadSnapshot, deleteSnapshot, restoreFiles, type ComposerSnapshot, type StoredOptions } from '$lib/publishing/snapshots';
  import { createJob, deliverJob, getJob, isComplete, type PublishJob } from '$lib/publishing/outbox';
  import DeliveryStatus from './DeliveryStatus.svelte';
  import DestinationPreviews from './DestinationPreviews.svelte';
  let restoredOptions: StoredOptions | null = $state(null);
  let pendingJob: PublishJob | null = $state(null);
  let overrides: Record<string, string> = $state({});
  let threadsMediaUrl = $state('');
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot: ComposerSnapshot | undefined;
  let savedWrites: Promise<void> = Promise.resolve();
  function floatingSnapshot() {
    return snapshot('floating-compose', text, selectedAccountIds, overrides, {
      visibility, contentWarning: showCW ? contentWarning : undefined, mediaFiles, altTexts,
      mediaUrls: threadsMediaUrl.trim() ? [threadsMediaUrl.trim()] : undefined,
      quoteUri: quotePost?.platform === 'bluesky' ? quotePost.uri : restoredOptions?.quoteUri,
      quoteCid: (quotePost?.raw as any)?.post?.cid ?? (quotePost?.raw as any)?.cid ?? restoredOptions?.quoteCid,
      quoteUrl: quotePost?.uri?.startsWith('https://') ? quotePost.uri : restoredOptions?.quoteUrl,
      replyTo: replyToPost ? {
        uri: replyToPost.uri, platform: replyToPost.platform, id: (replyToPost.raw as any)?.id,
        cid: (replyToPost.raw as any)?.post?.cid ?? (replyToPost.raw as any)?.cid,
      } : restoredOptions?.replyTo,
    }, pendingJob && !isComplete(pendingJob) ? pendingJob.id : undefined);
  }
  function persistFloating(saved: ComposerSnapshot) {
    savedWrites = savedWrites.catch(() => {}).then(async () => {
      if (saved.text.trim() || saved.media.length || saved.jobId) await saveSnapshot(saved);
      else await deleteSnapshot('floating-compose');
    }).catch(() => { error = i18n.t.workflow.saveError; });
  }
  $effect(() => {
    if (!loaded) return;
    const saved = floatingSnapshot();
    lastSnapshot = saved;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistFloating(saved), 500);
  });
  onDestroy(() => {
    clearTimeout(saveTimer);
    if (lastSnapshot) persistFloating(lastSnapshot);
    mediaPreviews.forEach(revokePreviewUrl);
  });

  import type { Account, UnifiedPost } from '$lib/types';

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
      const saved = await loadSnapshot('floating-compose');
      if (saved && !replyToPost && !quotePost) {
        pendingJob = saved.jobId ? await getJob(saved.jobId) ?? null : null;
        if (!pendingJob || !isComplete(pendingJob)) {
          restoredOptions = saved.options;
          text = saved.text; selectedAccountIds = saved.accountIds; overrides = saved.overrides;
          visibility = saved.options.visibility ?? 'public';
          contentWarning = saved.options.contentWarning ?? ''; showCW = !!contentWarning;
          mediaFiles = restoreFiles(saved); mediaPreviews = mediaFiles.map(createPreviewUrl);
          altTexts = saved.options.altTexts ?? []; threadsMediaUrl = saved.options.mediaUrls?.[0] ?? '';
        }
      }
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
    if (posting || pendingJob && !isComplete(pendingJob)) return;
    if (!text.trim() && !mediaFiles.length) return;
    const altMode = localStorage.getItem('crispdeck-alt-text-mode') ?? 'off';
    const missing = mediaFiles.some((_, index) => !altTexts[index]?.trim());
    if (missing && altMode === 'require') { error = i18n.t.compose.missingAltConfirm; return; }
    if (missing && altMode === 'warn' && !confirm(i18n.t.compose.missingAltConfirm)) return;
    posting = true; error = '';
    try {
      clearTimeout(saveTimer); await savedWrites;
      pendingJob = await createJob(floatingSnapshot(), accounts);
      await saveSnapshot({ ...floatingSnapshot(), jobId: pendingJob.id });
      await finishDelivery(false);
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }
  async function finishDelivery(allow: boolean) {
    if (!pendingJob) return;
    posting = true; error = '';
    try {
      pendingJob = await deliverJob(pendingJob.id, undefined, allow);
      if (isComplete(pendingJob)) {
        toast.success(i18n.t.workflow.posted);
        resetForm(); pendingJob = null;
        clearTimeout(saveTimer); lastSnapshot = undefined;
        await savedWrites;
        await deleteSnapshot('floating-compose');
        open = false; onposted?.();
      }
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  function resetForm() {
    selectedAccountIds = selectedAccountIds.filter(id => accounts.some(account => account.id === id));
    text = '';
    contentWarning = '';
    showCW = false;
    mediaPreviews.forEach(revokePreviewUrl);
    mediaFiles = [];
    mediaPreviews = [];
    altTexts = [];
    error = ''; overrides = {}; threadsMediaUrl = ''; restoredOptions = null;
  }

  function handleClose() {
    open = false;
  }
</script>

{#if open}
  <!-- Backdrop. A button rather than a div with a no-op onkeydown: it is a real
       focusable, Enter/Space-operable way out of the panel. -->
  <button
    type="button"
    class="fixed inset-0 z-[90] bg-black/40 floating-compose-backdrop"
    aria-label={i18n.t.compose.closeCompose}
    onclick={handleClose}
  ></button>

  <!-- Slide-in panel from right -->
  <div
    bind:this={panelEl}
    class="fixed top-0 right-0 z-[91] h-full w-full max-w-md bg-[var(--color-bg)] border-l border-[var(--color-border)] shadow-2xl flex flex-col floating-compose-panel"
    role="dialog"
    aria-modal="true"
    aria-label={i18n.t.compose.composePost}
    tabindex="-1"
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
      <button onclick={handleClose} aria-label={i18n.t.common.close} class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
        <X size={16} />
      </button>
    </div>

    {#if !loaded}
      <div class="flex-1 flex items-center justify-center">
        <Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin" />
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        {#if pendingJob}
          <DeliveryStatus job={pendingJob} busy={posting} onretry={finishDelivery} />
          {#if !isComplete(pendingJob)}
            <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.deliveryLocked}</p>
            <button disabled={posting} class="text-sm underline" onclick={() => { resetForm(); pendingJob = null; }}>{i18n.t.workflow.newDraft}</button>
          {/if}
        {/if}
        <fieldset disabled={posting || (!!pendingJob && !isComplete(pendingJob))} class="min-w-0 space-y-3">
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
            <button onclick={() => { showCW = false; contentWarning = ''; }} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={i18n.t.common.close}>
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
                  <button onclick={() => removeMedia(i)} class="absolute top-1 right-1 p-0.5 bg-black/70 rounded-full text-white hover:bg-black" aria-label={i18n.t.common.close}>
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
        <details><summary class="text-sm cursor-pointer">{i18n.t.compose.preview}</summary>
          <DestinationPreviews {accounts} selected={selectedAccountIds} sharedText={text} bind:overrides {threadsMediaUrl} {mediaPreviews} mediaTypes={mediaFiles.map(f => f.type)} {altTexts}
            {visibility} contentWarning={showCW ? contentWarning : ''} threadGate="everyone" disableQuotes={false} selfLabel="none" />
        </details>
        {#if hasThreads}
          <label class="block text-xs space-y-1"><span>{i18n.t.workflow.mediaUrl}</span><input type="url" bind:value={threadsMediaUrl} placeholder="https://" class="w-full p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]" /></label>
        {/if}
        </fieldset>
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
              data-testid="publish-post"
              disabled={posting || (!!pendingJob && !isComplete(pendingJob)) || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
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
