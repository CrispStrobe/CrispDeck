<script lang="ts">
  import { swallow } from '$lib/debug-log';
  import { removeKey, writeJson } from '$lib/safe-storage';
  import { hrefOrHash } from '$lib/safe-url';
  import { fetchOk } from '$lib/http';
  import { getSttEngine } from '$lib/settings';
  import { buildScheduledAt, minScheduleDate, formatScheduledFor } from '$lib/quick-schedule';
  import { base } from '$app/paths';
  import { onMount, onDestroy } from 'svelte';
  import { listDrafts } from '$lib/db';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { PenSquare, Send, Loader2, X, ImagePlus, AlertTriangle, Check, BarChart3, Shield, Mic, MicOff, Sparkles, Clock } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import AccountPicker from '$lib/components/AccountPicker.svelte';
  import MentionAutocomplete from '$lib/components/MentionAutocomplete.svelte';
  import EmojiPicker from '$lib/components/EmojiPicker.svelte';
  import GifPicker from '$lib/components/GifPicker.svelte';
  import { listTemplates, saveTemplate, deleteTemplate, type PostTemplate } from '$lib/templates';
  import { graphemeLength, type ThreadGate } from '$lib/compose/adapter';
  import { validateMediaFile, createPreviewUrl, revokePreviewUrl, isVideoFile } from '$lib/compose/media';
  import { tryVoiceCommand, looksLikeCommand } from '$lib/voice-commands';
  import { runAIAction, isAIConfigured, type AIAction } from '$lib/compose/ai';
  import { computeBestHour, formatHour, type PostingTimeInsight } from '$lib/posting-times';
  import { toast } from '$lib/toast.svelte';
  import { searchArchive } from '$lib/archive';
  import type { Account, Platform } from '$lib/types';
  import { snapshot, saveSnapshot, loadSnapshot, deleteSnapshot, restoreFiles, type ComposerSnapshot } from '$lib/publishing/snapshots';
  import { persistDraft, draftSnapshot, removeDraft } from '$lib/publishing/drafts';
  import { createJob, deliverJob, getJob, isComplete, type PublishJob } from '$lib/publishing/outbox';
  import DeliveryStatus from '$lib/components/DeliveryStatus.svelte';
  import DestinationPreviews from '$lib/components/DestinationPreviews.svelte';
  let pendingJob: PublishJob | null = $state(null);
  let overrides: Record<string, string> = $state({});
  let threadsMediaUrl = $state('');
  let autoSaveReady = $state(false);
  let autoSaveWrite: Promise<void> = Promise.resolve();
  let latestSnapshot: ComposerSnapshot | undefined;
  let saveError = $state('');

  function currentSnapshot(id = 'autosave') {
    const quoteUrl = quoteUri && quoteAuthor ? `https://bsky.app/profile/${quoteAuthor}/post/${quoteUri.split('/').pop()}` : undefined;
    return { ...snapshot(id, text, selectedAccountIds, overrides, {
      visibility, contentWarning: showCW ? contentWarning : undefined,
      mediaFiles, altTexts, mediaUrls: threadsMediaUrl.trim() ? [threadsMediaUrl.trim()] : undefined,
      quoteUri: quoteUri || undefined, quoteCid: quoteCid || undefined, quoteUrl,
      threadGate, selfLabel: selfLabel === 'none' ? undefined : selfLabel, disableQuotes,
      replyTo: replyTo ? { uri: replyTo, platform: replyPlatform as Platform } : undefined,
      poll: showPoll ? { options: pollOptions.filter(o => o.trim()), expiresIn: pollExpiry, multiple: pollMultiple } : undefined,
    }, pendingJob && !isComplete(pendingJob) ? pendingJob.id : undefined), context: { quoteAuthor, quoteText, replyAuthor } };
  }

  function applySnapshot(saved: ComposerSnapshot) {
    quoteAuthor = saved.context?.quoteAuthor ?? ''; quoteText = saved.context?.quoteText ?? ''; replyAuthor = saved.context?.replyAuthor ?? '';
    text = saved.text; selectedAccountIds = saved.accountIds; overrides = saved.overrides;
    visibility = saved.options.visibility ?? 'public';
    contentWarning = saved.options.contentWarning ?? ''; showCW = !!contentWarning;
    mediaFiles = restoreFiles(saved); mediaPreviews = mediaFiles.map(createPreviewUrl);
    altTexts = saved.options.altTexts ?? mediaFiles.map(() => '');
    threadsMediaUrl = saved.options.mediaUrls?.[0] ?? '';
    threadGate = saved.options.threadGate ?? 'everyone';
    selfLabel = (saved.options.selfLabel ?? 'none') as typeof selfLabel;
    disableQuotes = saved.options.disableQuotes ?? false;
    showPoll = !!saved.options.poll;
    pollOptions = saved.options.poll?.options ?? ['', ''];
    pollExpiry = saved.options.poll?.expiresIn ?? 86400;
    pollMultiple = saved.options.poll?.multiple ?? false;
    quoteUri = saved.options.quoteUri ?? ''; quoteCid = saved.options.quoteCid ?? '';
    replyTo = saved.options.replyTo?.uri ?? ''; replyPlatform = saved.options.replyTo?.platform ?? '';
  }

  $effect(() => {
    if (!autoSaveReady || loading) return;
    const saved = currentSnapshot();
    latestSnapshot = saved;
    scheduleAutoSave(saved);
  });
  onDestroy(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    if (latestSnapshot && autoSaveReady) queueAutoSave(latestSnapshot);
    mediaPreviews.forEach(revokePreviewUrl);
  });


  let accounts: Account[] = $state([]);
  let selectedAccountIds: number[] = $state([]);
  let loading = $state(true);
  let posting = $state(false);
  let error = $state('');

  // Auto-save key
  const AUTOSAVE_KEY = 'crispdeck-compose-autosave';

  // Compose state
  let text = $state('');
  let visibility = $state<'public' | 'unlisted' | 'private' | 'direct'>('public');
  let contentWarning = $state('');
  let showCW = $state(false);
  let mediaFiles: File[] = $state([]);
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSaveRestoredFrom: string | null = $state(null);

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
  // Self-label (Bluesky content warning)
  let selfLabel = $state<'none' | 'graphic-media' | 'nudity' | 'porn' | 'gore'>('none');
  let disableQuotes = $state(false);

  // Poll (Mastodon)
  let showPoll = $state(false);
  let pollOptions = $state(['', '']);
  let pollExpiry = $state(86400); // 24h default
  let pollMultiple = $state(false);

  // Video upload status
  let videoUploadStatus = $state('');

  // Quick schedule
  let showSchedule = $state(false);
  let scheduleDate = $state('');
  let scheduleTime = $state('');

  async function handleSchedule() {
    if ((!text.trim() && !mediaFiles.length) || !selectedAccountIds.length || !checkAltText() || posting) return;
    const scheduledAt = buildScheduledAt(scheduleDate, scheduleTime);
    if (!scheduledAt) return;
    posting = true;
    try {
      await persistDraft(currentSnapshot(), scheduledAt, editingDraftId ?? undefined);
      toast.success(`${i18n.t.workflow.scheduledFor} ${formatScheduledFor(scheduledAt)}`);
      resetComposer();
      showSchedule = false; scheduleDate = ''; scheduleTime = '';
      await clearAutoSave();
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  // AI compose
  let showAIMenu = $state(false);
  let aiLoading = $state(false);
  let aiError = $state('');

  async function handleAIAction(action: AIAction) {
    showAIMenu = false;
    aiError = '';
    if (action !== 'alt-text' && !text.trim()) return;
    aiLoading = true;
    try {
      const input = action === 'alt-text'
        ? 'Please describe the attached image for accessibility purposes.'
        : text;
      const result = await runAIAction(action, input);
      if (action === 'hashtags') {
        // Append hashtags to existing text
        text = text.trimEnd() + '\n\n' + result.text;
      } else if (action === 'alt-text') {
        // Apply to first media without alt text
        const idx = altTexts.findIndex(t => !t.trim());
        if (idx >= 0) altTexts[idx] = result.text;
      } else {
        // Replace text (correct/shorten)
        text = result.text;
      }
    } catch (e) {
      aiError = String(e instanceof Error ? e.message : e);
    } finally {
      aiLoading = false;
    }
  }

  function queueAutoSave(saved: ComposerSnapshot) {
    autoSaveWrite = autoSaveWrite.catch(() => {}).then(async () => {
      if (saved.text.trim() || saved.media.length || saved.jobId) await saveSnapshot(saved);
      else await deleteSnapshot('autosave');
      saveError = '';
    }).catch(() => { saveError = i18n.t.workflow.saveError; });
  }
  function scheduleAutoSave(saved = currentSnapshot()) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => queueAutoSave(saved), 500);
  }
  async function clearAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    latestSnapshot = undefined;
    autoSaveWrite = autoSaveWrite.catch(() => {}).then(() => deleteSnapshot('autosave'));
    await autoSaveWrite;
    removeKey(AUTOSAVE_KEY);
    autoSaveRestoredFrom = null;
  }
  function resetComposer() {
    selectedAccountIds = selectedAccountIds.filter(id => accounts.some(account => account.id === id));
    text = ''; contentWarning = ''; showCW = false;
    mediaPreviews.forEach(revokePreviewUrl); mediaFiles = []; mediaPreviews = []; altTexts = [];
    overrides = {}; editingDraftId = null; threadsMediaUrl = '';
    quoteUri = ''; quoteCid = ''; quoteAuthor = ''; quoteText = ''; replyTo = ''; replyAuthor = ''; replyPlatform = '';
  }
  function newDraft() { resetComposer(); pendingJob = null; void clearAutoSave(); }

  // Posting time insights
  let timingInsights: PostingTimeInsight[] = $state([]);

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

  // Focus the composer in script rather than with the autofocus attribute.
  // It has to wait for the binding: the textarea is behind `{#if loading}`,
  // which only flips once initAllClients() resolves, so onMount runs while the
  // element still does not exist. Guarded so a later re-render cannot yank
  // focus back out from under the user.
  let composerFocused = false;
  $effect(() => {
    if (textareaEl && !composerFocused) {
      composerFocused = true;
      textareaEl.focus();
    }
  });

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
          applySnapshot(await draftSnapshot(draft));
          editingDraftId = draft.id;
          pendingJob = await getJob(`draft-${draft.id}`) ?? null;
        }
      }

      // Reply context
      replyTo = params.get('replyTo') ?? replyTo;
      replyAuthor = params.get('author') ?? replyAuthor;
      replyPlatform = params.get('platform') ?? replyPlatform;
      if (replyAuthor && !text) {
        text = `@${replyAuthor} `;
      }

      // Quote context
      quoteUri = params.get('quoteUri') ?? quoteUri;
      quoteCid = params.get('quoteCid') ?? quoteCid;
      quoteAuthor = params.get('quoteAuthor') ?? quoteAuthor;
      quoteText = params.get('quoteText') ?? quoteText;

      // Handle shared content from PWA share_target
      const sharedText = params.get('text') ?? '';
      const sharedUrl = params.get('url') ?? '';
      const sharedTitle = params.get('title') ?? '';
      if ((sharedText || sharedUrl) && !text) {
        text = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n');
      }

      // Auto-restore unsent text (only if no draft/reply/quote context)
      if (!text && !replyTo && !quoteUri && !draftId) {
        const durable = await loadSnapshot('autosave');
        if (durable) {
          pendingJob = durable.jobId ? await getJob(durable.jobId) ?? null : null;
          if (!pendingJob || !isComplete(pendingJob)) {
            applySnapshot(durable);
            autoSaveRestoredFrom = durable.savedAt;
          }
        }
        const saved = !durable ? localStorage.getItem(AUTOSAVE_KEY) : null;
        if (saved) {
          try {
            const data = JSON.parse(saved);
            if (data.text?.trim()) {
              text = data.text;
              if (data.cw) { contentWarning = data.cw; showCW = true; }
              autoSaveRestoredFrom = data.savedAt ?? 'earlier';
            }
          } catch (e) { swallow('compose.clearAutoSave', e); }
        }
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      autoSaveReady = true;
      templates = listTemplates();

      // Load posting time insights from archive
      try {
        const archived = await searchArchive({ type: 'post', limit: 1000 });
        const postData = archived.map(p => ({
          createdAt: p.createdAt,
          likeCount: p.likeCount,
          repostCount: p.repostCount,
          platform: p.platform,
        }));
        const insights: PostingTimeInsight[] = [];
        const bsky = computeBestHour(postData, 'bluesky');
        const masto = computeBestHour(postData, 'mastodon');
        if (bsky) insights.push(bsky);
        if (masto) insights.push(masto);
        timingInsights = insights;
      } catch { /* archive may not exist */ }
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
    const missingAlt = mediaFiles.some((_, i) => !altTexts[i]?.trim());
    if (!missingAlt) return true;
    if (mode === 'require') {
      error = 'Alt text is required for all images. Add descriptions before posting.';
      return false;
    }
    if (mode === 'warn') {
      return confirm(i18n.t.compose.missingAltConfirm);
    }
    return true;
  }

  async function handlePost() {
    if (posting || pendingJob && !isComplete(pendingJob)) return;
    if ((!text.trim() && !mediaFiles.length) || !checkAltText()) return;
    posting = true; error = '';
    try {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      await autoSaveWrite;
      const saved = currentSnapshot();
      pendingJob = await createJob(saved, accounts, editingDraftId ?? undefined);
      await saveSnapshot({ ...saved, jobId: pendingJob.id });
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
        const completedDraftId = pendingJob.draftId ?? editingDraftId;
        if (completedDraftId !== null && completedDraftId !== undefined) {
          const draft = (await listDrafts()).find(d => d.id === completedDraftId);
          if (draft) await removeDraft(draft);
        }
        toast.success(i18n.t.workflow.posted);
        resetComposer();
        await clearAutoSave();
      } else {
        toast.warning(i18n.t.workflow.needsAttention);
      }
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  async function handleSaveDraft() {
    if ((!text.trim() && !mediaFiles.length) || posting) return;
    posting = true;
    try {
      editingDraftId = await persistDraft(currentSnapshot(), null, editingDraftId ?? undefined);
      toast.success(i18n.t.workflow.savedDraft);
      error = '';
    } catch (e) { error = String(e); }
    finally { posting = false; }
  }

  // Character counts per selected platform
  async function addGif(gif: { url: string; preview: string; width: number; height: number; title: string }) {
    if (mediaFiles.length >= 4) return;
    try {
      // A 404 from the GIF host returns an HTML error page, which was
      // attached as a .gif and rejected later by the upload.
      const resp = await fetchOk(gif.url, undefined, 'load GIF');
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

  // Dictation (Speech-to-Text)
  // Tries CrispASR via Tauri first (desktop), falls back to Web Speech API (browser).
  let dictating = $state(false);
  let recognition: any = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

  function insertAtCursor(transcript: string) {
    // Check for voice commands first — intercept before inserting as text
    if (looksLikeCommand(transcript) && tryVoiceCommand(transcript)) {
      return; // Command was executed, don't insert text
    }

    if (textareaEl) {
      const pos = textareaEl.selectionStart;
      const insert = transcript + ' ';
      text = text.substring(0, pos) + insert + text.substring(pos);
      requestAnimationFrame(() => {
        const newPos = pos + insert.length;
        textareaEl?.setSelectionRange(newPos, newPos);
      });
    } else {
      text += transcript + ' ';
    }
  }

  async function toggleDictation() {
    if (dictating) {
      // Stop recording
      recognition?.stop();
      mediaRecorder?.stop();
      dictating = false;
      return;
    }

    const engine = getSttEngine();

    // CrispASR path (desktop/mobile with Tauri)
    if (engine !== 'browser') {
      const w = globalThis as any;
      if (w.__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const available = await invoke('asr_available') as boolean;
          if (available) {
            await startCrispASRDictation(invoke);
            return;
          }
          if (engine === 'crispasr') {
            error = 'CrispASR not available in this build. Switch to "Browser" engine in Settings.';
            return;
          }
        } catch (e) { swallow('compose.toggleDictation', e); }
      } else if (engine === 'crispasr') {
        error = 'CrispASR requires the desktop app. Switch to "Browser" engine in Settings.';
        return;
      }
    }

    // Browser Web Speech API
    startWebSpeechDictation();
  }

  async function startCrispASRDictation(invoke: any) {
    // Record audio via browser MediaRecorder, then send PCM to CrispASR
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioChunks.length === 0) return;

        // Convert recorded audio to Float32 PCM at 16kHz
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const pcm = Array.from(decoded.getChannelData(0));
        audioCtx.close();

        // Send to CrispASR
        try {
          const sttModel = localStorage.getItem('crispdeck-stt-model') || 'whisper';
          const result = await invoke('transcribe_audio', {
            backend: sttModel,
            modelPath: null,
            pcm,
            language: null,
          }) as { text: string };
          if (result.text.trim()) insertAtCursor(result.text.trim());
        } catch (e) {
          error = `CrispASR transcription failed: ${e}`;
        }
      };

      mediaRecorder.start();
      dictating = true;
    } catch (e) {
      error = `Microphone access denied: ${e}`;
    }
  }

  function startWebSpeechDictation() {
    const SpeechRecognition = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      error = 'Speech recognition not supported in this browser.';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = localStorage.getItem('crispdeck-stt-lang') || 'en-US';

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          insertAtCursor(event.results[i][0].transcript);
        }
      }
    };
    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') error = `Dictation error: ${event.error}`;
      dictating = false;
    };
    recognition.onend = () => { dictating = false; };
    recognition.start();
    dictating = true;
  }

  const selectedAccounts = $derived(accounts.filter(a => selectedAccountIds.includes(a.id)));
  const hasBsky = $derived(selectedAccounts.some(a => a.platform === 'bluesky'));
  const hasMasto = $derived(selectedAccounts.some(a => a.platform === 'mastodon'));
  const hasThreads = $derived(selectedAccounts.some(a => a.platform === 'threads'));
  const bskyLen = $derived(graphemeLength(text));
  const mastoLen = $derived(text.length);
  const threadsLen = $derived(text.length);
  const bskyNeedsThread = $derived(hasBsky && bskyLen > 300);
  const mastoNeedsThread = $derived(hasMasto && mastoLen > 500);
  const threadsNeedsThread = $derived(hasThreads && threadsLen > 500);
  const needsThread = $derived(bskyNeedsThread || mastoNeedsThread || threadsNeedsThread);
</script>

<svelte:head><title>CrispDeck — Compose</title><meta name="description" content="Write and crosspost to Mastodon and Bluesky" /></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Compose tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="{base}/compose" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">{i18n.t.nav.compose}</a>
    <a href="{base}/drafts" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">{i18n.t.nav.drafts}</a>
  </div>

  <div class="flex items-center gap-2 mb-6">
    <PenSquare size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.compose.title}</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  {#if autoSaveRestoredFrom}
    <div class="mb-4 p-2 bg-blue-900/30 border border-blue-800 rounded-lg text-blue-200 text-xs flex items-center justify-between">
      <span>{i18n.t.compose.autoSaveRestored}</span>
      <button onclick={newDraft} class="underline ml-2">{i18n.t.compose.discard}</button>
    </div>
  {/if}

  {#if saveError}<p role="alert" class="mb-3 text-red-400 text-sm">{saveError}</p>{/if}
  {#if pendingJob}
    <div class="mb-4 space-y-3">
      <DeliveryStatus job={pendingJob} busy={posting} onretry={finishDelivery} />
      {#if !isComplete(pendingJob)}
        <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.workflow.deliveryLocked}</p>
        <button onclick={newDraft} disabled={posting} class="underline text-sm">{i18n.t.workflow.newDraft}</button>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="text-center py-12">
      <Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" />
    </div>
  {:else}
    <fieldset disabled={posting || (!!pendingJob && !isComplete(pendingJob))} class="min-w-0">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Main editor -->
      <div class="lg:col-span-2 space-y-4">
        <!-- Reply context -->
        {#if replyTo}
          <div class="p-3 bg-blue-950/30 border-l-4 border-blue-500 rounded-r-lg text-sm">
            <span class="text-blue-300">{i18n.t.compose.replyingTo}</span>
            <a href="{base}/profile?handle={encodeURIComponent(replyAuthor)}&platform={replyPlatform}" class="font-medium text-blue-400 hover:underline ml-1">@{replyAuthor}</a>
          </div>
        {/if}

        <!-- Quote context -->
        {#if quoteUri}
          <div class="p-3 bg-purple-950/30 border-l-4 border-purple-500 rounded-r-lg text-sm">
            <span class="text-purple-300">{i18n.t.compose.quoting}</span>
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
            <button onclick={async () => { const draft = (await listDrafts()).find(d => d.id === editingDraftId); if (draft) await removeDraft(draft); editingDraftId = null; }} class="text-yellow-400 hover:text-yellow-200 underline">{i18n.t.compose.discardDraft}</button>
          </div>
        {/if}

        <!-- Content warning -->
        {#if showCW}
          <div class="flex items-center gap-2">
            <input
              type="text"
              bind:value={contentWarning}
              placeholder={i18n.t.compose.cwPlaceholder}
              class="flex-1 px-3 py-2 bg-[var(--color-bg)] border border-yellow-600 rounded-md text-sm text-[var(--color-text)] focus:outline-none"
            />
            <button onclick={() => { showCW = false; contentWarning = ''; }} class="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={i18n.t.common.close}>
              <X size={14} />
            </button>
          </div>
        {/if}

        <!-- Text area with mention autocomplete -->
        <div class="relative">
          <textarea
            bind:this={textareaEl}
            bind:value={text}
            placeholder={i18n.t.compose.placeholder}
            rows="8"
            oninput={() => { mentionAutocomplete?.handleInput(); scheduleAutoSave(); }}
            onkeydown={(e) => {
              mentionAutocomplete?.handleKeydown(e);
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handlePost(); }
            }}
            class="w-full px-4 py-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] {needsThread ? 'border-yellow-500/50' : ''}"
          ></textarea>
          <MentionAutocomplete bind:this={mentionAutocomplete} textarea={textareaEl} bind:text />

          <!-- Character counts with warning thresholds -->
          <!-- Character count rings -->
          <div class="mt-1 flex flex-wrap justify-end items-center gap-2.5 text-xs">
            {#if hasBsky}
              {@const pct = Math.min(bskyLen / 300, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-bluesky)'}
              <span class="flex items-center gap-1 {pct >= 1 ? 'text-yellow-400 font-bold' : pct >= 0.9 ? 'text-red-400' : pct >= 0.8 ? 'text-orange-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="18" height="18" viewBox="0 0 18 18" class="flex-shrink-0">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round"
                    transform="rotate(-90 9 9)" />
                </svg>
                {bskyLen}/300{bskyNeedsThread ? ' →' : ''}
              </span>
            {/if}
            {#if hasMasto}
              {@const pct = Math.min(mastoLen / 500, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-mastodon)'}
              <span class="flex items-center gap-1 {pct >= 1 ? 'text-yellow-400 font-bold' : pct >= 0.9 ? 'text-red-400' : pct >= 0.8 ? 'text-orange-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="18" height="18" viewBox="0 0 18 18" class="flex-shrink-0">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round"
                    transform="rotate(-90 9 9)" />
                </svg>
                {mastoLen}/500{mastoNeedsThread ? ' →' : ''}
              </span>
            {/if}
            {#if hasThreads}
              {@const pct = Math.min(threadsLen / 500, 1)}
              {@const color = pct >= 1 ? '#facc15' : pct >= 0.9 ? '#f87171' : pct >= 0.8 ? '#fb923c' : 'var(--color-threads, #888)'}
              <span class="flex items-center gap-1 {pct >= 1 ? 'text-yellow-400 font-bold' : pct >= 0.9 ? 'text-red-400' : pct >= 0.8 ? 'text-orange-400' : 'text-[var(--color-text-muted)]'}">
                <svg width="18" height="18" viewBox="0 0 18 18" class="flex-shrink-0">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-border)" stroke-width="2" />
                  <circle cx="9" cy="9" r="7" fill="none" stroke={color} stroke-width="2"
                    stroke-dasharray="{pct * 44} 44" stroke-linecap="round"
                    transform="rotate(-90 9 9)" />
                </svg>
                {threadsLen}/500{threadsNeedsThread ? ' →' : ''}
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
                  {#if mediaFiles[i] && isVideoFile(mediaFiles[i])}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video src={preview} class="w-full h-full object-cover" muted></video>
                  {:else}
                    <img loading="lazy" src={preview} alt={altTexts[i] || ''} class="w-full h-full object-cover" />
                  {/if}
                  <button
                    onclick={() => removeMedia(i)}
                    class="absolute top-1 right-1 p-1 bg-black/70 rounded-full text-white hover:bg-black"
                   aria-label={i18n.t.common.close}>
                    <X size={12} />
                  </button>
                </div>
                <div class="relative">
                  <input
                    type="text"
                    bind:value={altTexts[i]}
                    placeholder={i18n.t.compose.altTextPlaceholder}
                    class="w-full px-2 py-1.5 pr-16 bg-transparent border-t text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none {altTextEnforced && !altTexts[i]?.trim() ? 'border-yellow-500 bg-yellow-950/20' : 'border-[var(--color-border)]'}"
                  />
                  <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] {altTexts[i]?.trim() ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}">
                    {altTexts[i]?.length ?? 0}/1000
                  </span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
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
            <button
              onclick={toggleDictation}
              class="p-1.5 rounded-md transition-colors {dictating ? 'text-red-400 bg-red-900/20 animate-pulse' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}"
              title={dictating ? 'Stop dictation' : 'Dictate (speech-to-text)'}
            >
              {#if dictating}<MicOff size={16} />{:else}<Mic size={16} />{/if}
            </button>

            <!-- AI Compose -->
            {#if isAIConfigured()}
              <div class="relative">
                <button
                  onclick={() => showAIMenu = !showAIMenu}
                  disabled={aiLoading}
                  class="p-1.5 rounded-md transition-colors {showAIMenu ? 'text-purple-400 bg-purple-900/20' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}"
                  title={i18n.t.compose.aiAssist}
                >
                  {#if aiLoading}<Loader2 size={16} class="animate-spin" />{:else}<Sparkles size={16} />{/if}
                </button>
                {#if showAIMenu}
                  <!-- Click-outside backdrop -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="fixed inset-0 z-40" onclick={() => showAIMenu = false} onkeydown={() => {}}></div>
                  <div class="absolute bottom-full left-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 w-44 py-1">
                    <button onclick={() => handleAIAction('correct')} disabled={!text.trim()} class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-30">
                      {i18n.t.compose.aiCorrect}
                    </button>
                    <button onclick={() => handleAIAction('shorten')} disabled={!text.trim()} class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-30">
                      {i18n.t.compose.aiShorten}
                    </button>
                    <button onclick={() => handleAIAction('hashtags')} disabled={!text.trim()} class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-30">
                      {i18n.t.compose.aiHashtags}
                    </button>
                    {#if mediaFiles.length > 0}
                      <button onclick={() => handleAIAction('alt-text')} class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)]">
                        {i18n.t.compose.aiAltText}
                      </button>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
            {#if aiError}
              <span class="text-[10px] text-red-400 max-w-[150px] truncate" title={aiError}>{aiError}</span>
            {/if}

            <!-- Templates -->
            <div class="relative">
              <button
                onclick={() => showTemplates = !showTemplates}
                class="px-2 py-1 text-xs border rounded-md transition-colors {showTemplates ? 'border-[var(--color-primary)] text-[var(--color-primary-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
              >
                Tpl
              </button>
              {#if showTemplates}
                <div class="absolute bottom-full left-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 w-56 max-h-48 overflow-y-auto py-1">
                  <button
                    onclick={() => { saveTemplate({ name: text.trim().substring(0, 30) || 'Untitled', text: text.trim(), visibility, contentWarning: showCW ? contentWarning : undefined }); templates = listTemplates(); showTemplates = false; }}
                    disabled={!text.trim()}
                    class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30"
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
                        <button onclick={() => { deleteTemplate(tpl.id); templates = listTemplates(); }} class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] ml-1" aria-label={i18n.t.common.close}>
                          <X size={10} />
                        </button>
                      </div>
                    {/each}
                  {:else}
                    <p class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">{i18n.t.compose.noTemplates}</p>
                  {/if}
                </div>
              {/if}
            </div>

            <details class="relative">
              <summary class="text-xs cursor-pointer whitespace-nowrap">{i18n.t.workflow.advanced}</summary>
              <div class="absolute z-30 right-0 w-64 p-3 space-y-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl">
            {#if hasMasto}
              <select
                bind:value={visibility}
                class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none"
              >
                <option value="public">{i18n.t.compose.public}</option>
                <option value="unlisted">{i18n.t.compose.unlisted}</option>
                <option value="private">{i18n.t.compose.followersOnlyVis}</option>
                <option value="direct">{i18n.t.compose.direct}</option>
              </select>

              <button
                onclick={() => showPoll = !showPoll}
                class="p-1.5 rounded-md transition-colors {showPoll ? 'text-[var(--color-mastodon)] bg-[var(--color-mastodon)]/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
                title={i18n.t.compose.addPollMastodon}
              >
                <BarChart3 size={14} />
              </button>
            {/if}

            {#if hasBsky}
              <select
                bind:value={threadGate}
                class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none"
                title={i18n.t.compose.whoCanReplyBluesky}
              >
                <option value="everyone">{i18n.t.compose.anyoneCanReply}</option>
                <option value="mentioned">{i18n.t.compose.mentionedOnly}</option>
                <option value="following">{i18n.t.workflow.followingReplies}</option>
                <option value="nobody">{i18n.t.compose.noReplies}</option>
              </select>
              <select
                bind:value={selfLabel}
                class="px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none"
                title={i18n.t.compose.contentLabelBluesky}
              >
                <option value="none">{i18n.t.compose.noLabel}</option>
                <option value="graphic-media">{i18n.t.compose.labelGraphicMedia}</option>
                <option value="nudity">{i18n.t.compose.labelNudity}</option>
                <option value="porn">{i18n.t.compose.labelPorn}</option>
                <option value="gore">{i18n.t.compose.labelGore}</option>
              </select>
              <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] cursor-pointer" title={i18n.t.compose.disableQuoting}>
                <input type="checkbox" bind:checked={disableQuotes} class="rounded" />
                No quotes
              </label>
            {/if}
              </div>
            </details>
          </div>

          {#if timingInsights.length > 0}
            <div class="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
              <Clock size={10} />
              {#each timingInsights as insight}
                <span>
                  <span class="w-1.5 h-1.5 rounded-full inline-block" style="background: {insight.platform === 'bluesky' ? 'var(--color-bluesky)' : insight.platform === 'threads' ? 'var(--color-threads, #000)' : 'var(--color-mastodon)'}"></span>
                  {i18n.t.compose.bestTime} {formatHour(insight.bestHour)}
                </span>
              {/each}
            </div>
          {/if}

          <div class="flex flex-wrap items-center gap-2 min-w-0">
            {#if videoUploadStatus}
              <span class="flex items-center gap-1.5 text-xs text-blue-300">
                <Loader2 size={12} class="animate-spin" />
                {videoUploadStatus === 'uploading' ? 'Uploading video...' : videoUploadStatus === 'processing' ? 'Processing video...' : videoUploadStatus === 'JOB_STATE_COMPLETED' ? 'Video ready' : `Video: ${videoUploadStatus}`}
              </span>
            {/if}
            <button
              onclick={handleSaveDraft}
              disabled={!text.trim()}
              class="px-3 py-2 text-sm whitespace-nowrap text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
            >
              Save Draft
            </button>
            <div class="relative">
              <button
                onclick={() => showSchedule = !showSchedule}
                disabled={!text.trim()}
                class="flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
              >
                <Clock size={14} />
                Schedule
              </button>
              {#if showSchedule}
                <div class="absolute bottom-full right-0 mb-1 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 w-56">
                  <div class="space-y-2">
                    <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.scheduleHint}</p>
                    <p class="text-xs">{i18n.t.workflow.timezone}: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
                    <label for="schedule-date" class="text-xs text-[var(--color-text-muted)]">{i18n.t.compose.date}</label>
                    <input id="schedule-date" type="date" bind:value={scheduleDate}
                      min={minScheduleDate()}
                      class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] focus:outline-none" />
                    <label for="schedule-time" class="text-xs text-[var(--color-text-muted)]">{i18n.t.compose.time}</label>
                    <input id="schedule-time" type="time" bind:value={scheduleTime}
                      class="w-full px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] focus:outline-none" />
                    <button
                      onclick={handleSchedule}
                      disabled={!scheduleDate || !scheduleTime}
                      class="w-full px-3 py-1.5 bg-[var(--color-primary)] text-white text-xs rounded disabled:opacity-50"
                    >
                      Schedule Post
                    </button>
                  </div>
                </div>
              {/if}
            </div>
            <button
              onclick={handlePost}
              data-testid="publish-post"
              disabled={posting || (!text.trim() && mediaFiles.length === 0) || selectedAccountIds.length === 0}
              class="flex items-center gap-2 whitespace-nowrap px-5 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
            >
              {#if posting}
                <Loader2 size={14} class="animate-spin" />
                {i18n.t.compose.posting}
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
              <button onclick={() => showPoll = false} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label={i18n.t.common.close}>
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
                <option value={3600}>{i18n.t.compose.hour1}</option>
                <option value={21600}>{i18n.t.compose.hours6}</option>
                <option value={86400}>{i18n.t.compose.hours24}</option>
                <option value={259200}>{i18n.t.compose.days3}</option>
                <option value={604800}>{i18n.t.compose.days7}</option>
              </select>
            </div>
          </div>
        {/if}
      </div>

      <!-- Sidebar: Account picker -->
      <div class="space-y-4">
        <AccountPicker {accounts} bind:selected={selectedAccountIds} />

        <DestinationPreviews {accounts} selected={selectedAccountIds} sharedText={text} bind:overrides {threadsMediaUrl} {mediaPreviews} mediaTypes={mediaFiles.map(f => f.type)} {altTexts}
          {visibility} contentWarning={showCW ? contentWarning : ''} {threadGate} {disableQuotes} {selfLabel} />
        {#if hasThreads}
          <label class="block text-sm space-y-2">
            <span>{i18n.t.workflow.mediaUrl}</span>
            <input type="url" bind:value={threadsMediaUrl} placeholder="https://" class="w-full p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]" />
            <span class="block text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.threadsMediaHint}</span>
          </label>
        {/if}
      </div>
    </div>
    </fieldset>
  {/if}
</div>
