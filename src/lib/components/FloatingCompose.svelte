<script lang="ts">
  import { X, Send, Loader2, ImagePlus, PenSquare, Clock, FileText } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { initAllClients } from '$lib/api/client-factory';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import { graphemeLength } from '$lib/compose/adapter';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl, isVideoFile } from '$lib/compose/media';
  import { postContext, postContextKey, hasDraftContent, type PostContext } from '$lib/compose/context';
  import { mediaAttachmentLimit, parseMediaUrls, validateMediaForPlatform } from '$lib/compose/media-policy';
  import { toast } from '$lib/toast.svelte';
  import { snapshot, saveSnapshot, loadSnapshot, deleteSnapshot, restoreFiles, type ComposerSnapshot, type StoredOptions } from '$lib/publishing/snapshots';
  import { persistDraft } from '$lib/publishing/drafts';
  import { createJob, deliverJob, getJob, isComplete, type PublishJob } from '$lib/publishing/outbox';
  import { buildScheduledAt, minScheduleDate, formatScheduledFor } from '$lib/quick-schedule';
  import DeliveryStatus from './DeliveryStatus.svelte';
  import DestinationPreviews from './DestinationPreviews.svelte';
  import type { Account, UnifiedPost } from '$lib/types';

  let {
    open = $bindable(false), replyToPost = null, quotePost = null, onposted,
  }: {
    open: boolean;
    replyToPost?: UnifiedPost | null;
    quotePost?: UnifiedPost | null;
    onposted?: () => void;
  } = $props();

  let accounts: Account[] = $state([]);
  let selectedAccountIds: number[] = $state([]);
  let loaded = $state(false);
  let loadFailed = $state(false);
  let preparing = $state(false);
  let posting = $state(false);
  let error = $state('');
  let saveError = $state('');
  let text = $state('');
  let mediaFiles: File[] = $state([]);
  let mediaPreviews: string[] = $state([]);
  let altTexts: string[] = $state([]);
  let visibility = $state<'public' | 'unlisted' | 'private' | 'direct'>('public');
  let contentWarning = $state('');
  let showCW = $state(false);
  let overrides: Record<string, string> = $state({});
  let threadsMediaUrl = $state('');
  let pendingJob: PublishJob | null = $state(null);
  // Keep options that this compact UI does not edit (polls, reply gates, labels).
  // Never use live reply/quote props while saving an already-edited draft.
  let restoredOptions: StoredOptions = $state({});
  let context: PostContext['display'] = $state({ quoteAuthor: '', quoteText: '', replyAuthor: '' });
  let persistedDraftId: number | undefined;
  let showSchedule = $state(false);
  let scheduleDate = $state('');
  let scheduleTime = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();

  const selectedAccounts = $derived(accounts.filter(a => selectedAccountIds.includes(a.id)));
  const hasBsky = $derived(selectedAccounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(selectedAccounts.some(a => a.platform === 'mastodon'));
  const hasThreads = $derived(selectedAccounts.some(a => a.platform === 'threads'));
  const mediaLimit = $derived(mediaAttachmentLimit(selectedAccounts.map(account => account.platform)));
  const bskyLen = $derived(graphemeLength(text));
  const mastoLen = $derived(text.length);
  const threadsLen = $derived(text.length);
  const needsThread = $derived(
    (hasBsky && bskyLen > 300) || (hasMasto && mastoLen > 500) || (hasThreads && threadsLen > 500)
  );
  const deliveryLocked = $derived(!!pendingJob && !isComplete(pendingJob));
  const busy = $derived(posting || preparing);
  const hasContent = $derived(!!text.trim() || mediaFiles.length > 0 || Object.values(overrides).some(value => !!value.trim()) || !!threadsMediaUrl.trim());
  const replyLabel = $derived(context.replyAuthor ? `@${context.replyAuthor}` : restoredOptions.replyTo?.uri ?? '');
  const quoteLabel = $derived(context.quoteAuthor ? `@${context.quoteAuthor}` : restoredOptions.quoteUrl ?? restoredOptions.quoteUri ?? '');

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let savedWrites: Promise<void> = Promise.resolve();
  let saveGeneration = 0;
  let accountLoad: Promise<void> | undefined;
  let contextChanges: Promise<void> = Promise.resolve();
  let requestSequence = 0;
  let disposed = false;
  let wasOpen = false;
  let returnFocus: HTMLElement | null = null;

  function floatingSnapshot(): ComposerSnapshot {
    return { ...snapshot('floating-compose', text, selectedAccountIds, overrides, {
      ...restoredOptions,
      visibility, contentWarning: showCW ? contentWarning : undefined, mediaFiles, altTexts,
      mediaUrls: parseMediaUrls(threadsMediaUrl),
    }, deliveryLocked ? pendingJob!.id : undefined), context: { ...context } };
  }

  function persistFloating(saved: ComposerSnapshot) {
    const generation = saveGeneration;
    savedWrites = savedWrites.catch(() => {}).then(async () => {
      if (generation !== saveGeneration) return;
      if (hasDraftContent(saved) || saved.jobId) await saveSnapshot(saved);
      else await deleteSnapshot('floating-compose');
      saveError = '';
    }).catch(() => { saveError = i18n.t.workflow.saveError; });
  }

  async function clearAutoSave() {
    clearTimeout(saveTimer);
    saveGeneration++;
    savedWrites = savedWrites.catch(() => {}).then(() => deleteSnapshot('floating-compose'));
    await savedWrites;
    saveError = '';
  }

  $effect(() => {
    if (!loaded || preparing || posting) { clearTimeout(saveTimer); return; }
    const saved = floatingSnapshot();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistFloating(saved), 500);
  });

  function applySnapshot(saved: ComposerSnapshot) {
    mediaPreviews.forEach(revokePreviewUrl);
    restoredOptions = saved.options;
    context = saved.context ?? { quoteAuthor: '', quoteText: '', replyAuthor: '' };
    text = saved.text; selectedAccountIds = [...saved.accountIds]; overrides = { ...saved.overrides };
    visibility = saved.options.visibility ?? 'public';
    contentWarning = saved.options.contentWarning ?? ''; showCW = !!contentWarning;
    mediaFiles = restoreFiles(saved); mediaPreviews = mediaFiles.map(createPreviewUrl);
    altTexts = [...(saved.options.altTexts ?? mediaFiles.map(() => ''))];
    threadsMediaUrl = saved.options.mediaUrls?.join('\n') ?? '';
  }

  async function loadAccounts() {
    if (loaded) return;
    if (!accountLoad) accountLoad = (async () => {
      const result = await initAllClients();
      const saved = await loadSnapshot('floating-compose');
      const job = saved?.jobId ? await getJob(saved.jobId) : undefined;
      if (disposed) return;
      accounts = result.accounts;
      selectedAccountIds = accounts.map(a => a.id);
      if (job && !isComplete(job)) {
        // The outbox is the source of truth after a delivery has begun.
        pendingJob = job;
        applySnapshot(job.snapshot);
      } else if (saved && !job) {
        applySnapshot(saved);
      }
      loaded = true;
    })().finally(() => { accountLoad = undefined; });
    await accountLoad;
  }

  async function prepareContext(reply: UnifiedPost | null, quote: UnifiedPost | null, sequence: number) {
    try {
      if (disposed || sequence !== requestSequence) return;
      await loadAccounts();
      if (disposed || sequence !== requestSequence) return;
      // The Compose button resumes the current draft, including its context.
      if (!reply && !quote) return;
      const requested = postContext(reply, quote);
      if (postContextKey(requested.options) === postContextKey(restoredOptions)) return;
      if (posting || deliveryLocked) { error = i18n.t.workflow.deliveryLocked; return; }
      const saved = floatingSnapshot();
      if (hasDraftContent(saved)) {
        persistedDraftId = await persistDraft(saved, null, persistedDraftId);
        toast.success(i18n.t.workflow.savedDraft);
      }
      if (disposed) return;
      resetForm();
      restoredOptions = requested.options;
      context = requested.display;
      text = reply ? `@${reply.author.handle} ` : '';
      const sourceId = (reply ?? quote)?.sourceAccountId;
      if (sourceId !== undefined && accounts.some(account => account.id === sourceId)) selectedAccountIds = [sourceId];
      persistFloating(floatingSnapshot());
    } catch (e) { error = String(e); if (!loaded) loadFailed = true; }
    finally { if (sequence === requestSequence) preparing = false; }
  }

  $effect(() => {
    const visible = open;
    const reply = replyToPost;
    const quote = quotePost;
    untrack(() => {
      const sequence = ++requestSequence;
      if (visible) {
        if (!wasOpen) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        preparing = true;
        contextChanges = contextChanges.then(() => prepareContext(reply, quote, sequence));
      } else {
        preparing = false;
        if (wasOpen) returnFocus?.focus();
      }
      wasOpen = visible;
    });
  });

  $effect(() => {
    if (open && loaded && !preparing && textareaEl) {
      requestAnimationFrame(() => { if (open) textareaEl?.focus(); });
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (showSchedule) showSchedule = false;
      else handleClose();
      return;
    }
    if (!e.isComposing && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!showSchedule) void handlePost();
      return;
    }
    if (e.key === 'Tab' && panelEl) {
      const focusable = Array.from(panelEl.querySelectorAll<HTMLElement>(
        'button, textarea, input:not([type="hidden"]), select, summary, [tabindex]:not([tabindex="-1"])'
      )).filter(element => !element.matches(':disabled') && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function addMedia(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || busy || deliveryLocked) return;
    const additions = Array.from(input.files);
    input.value = '';
    if (mediaFiles.length + additions.length > mediaLimit) { error = i18n.t.compose.tooManyMedia.replace('{count}', String(mediaLimit)); return; }
    const invalid = additions.map(validateMediaFile).find(Boolean);
    if (invalid) { error = invalid; return; }
    mediaFiles = [...mediaFiles, ...additions];
    mediaPreviews = [...mediaPreviews, ...additions.map(createPreviewUrl)];
    altTexts = [...altTexts, ...additions.map(() => '')];
  }

  function removeMedia(index: number) {
    if (busy || deliveryLocked) return;
    revokePreviewUrl(mediaPreviews[index]);
    mediaFiles = mediaFiles.filter((_, i) => i !== index);
    mediaPreviews = mediaPreviews.filter((_, i) => i !== index);
    altTexts = altTexts.filter((_, i) => i !== index);
  }

  function checkAltText(): boolean {
    const mode = localStorage.getItem('crispdeck-alt-text-mode') ?? 'off';
    const missing = mediaFiles.some((_, index) => !altTexts[index]?.trim());
    if (missing && mode === 'require') { error = i18n.t.compose.altTextRequired; return false; }
    if (missing && mode === 'warn') return confirm(i18n.t.compose.missingAltConfirm);
    return true;
  }

  function checkMedia(): boolean {
    for (const account of selectedAccounts) {
      const issue = validateMediaForPlatform(account.platform, mediaFiles, parseMediaUrls(threadsMediaUrl));
      if (issue) { error = `@${account.handle}: ${issue}`; return false; }
    }
    return true;
  }

  async function handlePost() {
    if (busy || deliveryLocked || !hasContent || !selectedAccountIds.length || !checkAltText() || !checkMedia()) return;
    posting = true; error = '';
    try {
      clearTimeout(saveTimer); await savedWrites.catch(() => {});
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
        await clearAutoSave();
        resetForm(); pendingJob = null;
        open = false; onposted?.();
      }
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  async function handleSaveDraft(scheduledAt: string | null = null) {
    if (busy || deliveryLocked || !hasContent) return;
    if (scheduledAt) {
      if (!selectedAccountIds.length) return;
      if (!checkAltText()) return;
      if (!checkMedia()) return;
    }
    posting = true; error = '';
    try {
      clearTimeout(saveTimer); await savedWrites.catch(() => {});
      persistedDraftId = await persistDraft(floatingSnapshot(), scheduledAt, persistedDraftId);
      await clearAutoSave();
      toast.success(scheduledAt ? `${i18n.t.workflow.scheduledFor} ${formatScheduledFor(scheduledAt)}` : i18n.t.workflow.savedDraft);
      resetForm(); open = false;
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  async function handleSchedule() {
    const scheduledAt = buildScheduledAt(scheduleDate, scheduleTime);
    if (!scheduledAt || Date.parse(scheduledAt) <= Date.now()) { error = i18n.t.compose.scheduleFuture; return; }
    await handleSaveDraft(scheduledAt);
  }

  async function newDraft() {
    if (busy) return;
    posting = true; error = '';
    try {
      if (!deliveryLocked && hasContent) {
        persistedDraftId = await persistDraft(floatingSnapshot(), null, persistedDraftId);
        toast.success(i18n.t.workflow.savedDraft);
      }
      await clearAutoSave();
      resetForm(); pendingJob = null;
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  function resetForm() {
    clearTimeout(saveTimer); saveGeneration++;
    selectedAccountIds = selectedAccountIds.filter(id => accounts.some(account => account.id === id));
    text = ''; contentWarning = ''; showCW = false; visibility = 'public';
    mediaPreviews.forEach(revokePreviewUrl);
    mediaFiles = []; mediaPreviews = []; altTexts = [];
    error = ''; overrides = {}; threadsMediaUrl = ''; restoredOptions = {};
    context = { quoteAuthor: '', quoteText: '', replyAuthor: '' };
    persistedDraftId = undefined;
    showSchedule = false; scheduleDate = ''; scheduleTime = '';
  }

  function handleClose() {
    if (loaded) { clearTimeout(saveTimer); persistFloating(floatingSnapshot()); }
    open = false;
  }

  onDestroy(() => {
    disposed = true; requestSequence++;
    clearTimeout(saveTimer);
    if (loaded) persistFloating(floatingSnapshot());
    mediaPreviews.forEach(revokePreviewUrl);
  });
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
      <div class="flex items-center gap-2 min-w-0">
        <PenSquare size={16} />
        <span class="text-sm font-semibold truncate">
          {#if restoredOptions.replyTo}
            {i18n.t.compose.replyingTo} {replyLabel}
          {:else if restoredOptions.quoteUri || restoredOptions.quoteUrl}
            {i18n.t.compose.quoting} {quoteLabel}
          {:else}
            {i18n.t.compose.title}
          {/if}
        </span>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        {#if loaded}
          <button onclick={newDraft} disabled={busy} class="text-xs text-[var(--color-primary-text)] disabled:opacity-50">{i18n.t.workflow.newDraft}</button>
        {/if}
        <button onclick={handleClose} aria-label={i18n.t.common.close} class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>

    {#if error || saveError}
      <div role="alert" class="m-3 p-2 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-xs">
        {error || saveError}
        <button onclick={() => { error = ''; saveError = ''; }} class="ml-2 underline">{i18n.t.common.dismiss}</button>
      </div>
    {/if}
    {#if !loaded}
      <div class="flex-1 flex items-center justify-center">
        {#if loadFailed}
          <button onclick={() => { error = ''; loadFailed = false; preparing = true; void prepareContext(replyToPost, quotePost, ++requestSequence); }} class="text-sm underline">{i18n.t.feed.retry}</button>
        {:else}
          <Loader2 size={24} class="text-[var(--color-text-muted)] animate-spin" />
        {/if}
      </div>
    {:else}
      <div class="flex-1 overflow-y-auto p-4 space-y-3">
        {#if pendingJob}
          <DeliveryStatus job={pendingJob} busy={busy} onretry={finishDelivery} />
          {#if deliveryLocked}
            <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.deliveryLocked}</p>
          {/if}
        {/if}
        <fieldset disabled={busy || deliveryLocked} class="min-w-0 space-y-3">

        <!-- Quote context preview -->
        {#if restoredOptions.quoteUri || restoredOptions.quoteUrl}
          <div class="p-2 bg-purple-950/30 border-l-4 border-purple-500 rounded-r-lg text-xs">
            <span class="text-purple-300">{i18n.t.compose.quoting}</span>
            <span class="font-medium text-purple-400 ml-1">{quoteLabel}</span>
            <p class="text-[var(--color-text-muted)] mt-1 line-clamp-2">{context.quoteText.substring(0, 100)}</p>
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
            aria-label={i18n.t.compose.composePost}
            placeholder={i18n.t.compose.placeholder}
            rows="6"
            class="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] {needsThread ? 'border-yellow-500/50' : ''}"
          ></textarea>
          <!-- Character count rings -->
          <div class="mt-1 flex flex-wrap justify-end items-center gap-2 text-[10px]">
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
            {visibility} contentWarning={showCW ? contentWarning : ''} threadGate={restoredOptions.threadGate ?? 'everyone'} disableQuotes={restoredOptions.disableQuotes ?? false} selfLabel={restoredOptions.selfLabel ?? 'none'} />
        </details>
        {#if hasThreads}
          <label class="block text-xs space-y-1"><span>{i18n.t.workflow.mediaUrl}</span><textarea bind:value={threadsMediaUrl} rows="3" placeholder="https://" class="w-full p-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"></textarea><span class="block text-[var(--color-text-muted)]">{i18n.t.compose.threadsUrlsHint}</span></label>
        {/if}
        </fieldset>
      </div>

      <!-- Bottom toolbar -->
      <fieldset disabled={busy || deliveryLocked} class="px-4 py-3 min-w-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex-shrink-0 space-y-3">
        <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.compose.mediaLimitHint.replace('{count}', String(mediaLimit))}</p>
        {#if mediaFiles.length > mediaLimit}<p role="alert" class="text-xs text-red-400">{i18n.t.compose.tooManyMedia.replace('{count}', String(mediaLimit))}</p>{/if}
        {#if showSchedule}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2" aria-label={i18n.t.drafts.schedule}>
            <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.scheduleHint}</p>
            <p class="text-xs">{i18n.t.workflow.timezone}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs space-y-1"><span>{i18n.t.compose.date}</span>
                <input type="date" bind:value={scheduleDate} min={minScheduleDate()} class="w-full min-w-0 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded" />
              </label>
              <label class="text-xs space-y-1"><span>{i18n.t.compose.time}</span>
                <input type="time" bind:value={scheduleTime} class="w-full min-w-0 px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded" />
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button onclick={handleSchedule} disabled={!scheduleDate || !scheduleTime || !selectedAccountIds.length} class="px-3 py-1.5 bg-[var(--color-primary)] text-white text-xs rounded disabled:opacity-50">{i18n.t.compose.schedulePost}</button>
              <button onclick={() => showSchedule = false} class="text-xs text-[var(--color-text-muted)]">{i18n.t.common.cancel}</button>
            </div>
          </div>
        {/if}
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-1.5">
            <label title={i18n.t.compose.addMedia} class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md cursor-pointer transition-colors {mediaFiles.length >= mediaLimit ? 'opacity-50 pointer-events-none' : ''}">
              <ImagePlus size={16} />
              <input type="file" aria-label={i18n.t.compose.addMedia} accept="image/*,video/mp4,video/webm,video/quicktime" disabled={mediaFiles.length >= mediaLimit} multiple class="sr-only" onchange={addMedia} />
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
              {i18n.t.compose.cw}
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
          <div class="flex items-center justify-end flex-wrap gap-2 ml-auto">
            <button onclick={() => handleSaveDraft()} disabled={!hasContent} class="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50">
              <FileText size={12} /> {i18n.t.compose.saveDraft}
            </button>
            <button onclick={() => showSchedule = !showSchedule} aria-expanded={showSchedule} disabled={!hasContent || !selectedAccountIds.length} class="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50">
              <Clock size={12} /> {i18n.t.drafts.schedule}
            </button>
            <button
              onclick={handlePost}
              data-testid="publish-post"
              disabled={busy || deliveryLocked || !hasContent || selectedAccountIds.length === 0}
              class="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors"
            >
              {#if posting}
                <Loader2 size={12} class="animate-spin" />
                {i18n.t.compose.posting}
              {:else}
                <Send size={12} />
                {needsThread ? i18n.t.compose.postThread : i18n.t.compose.post}
              {/if}
            </button>
          </div>
        </div>
      </fieldset>
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
