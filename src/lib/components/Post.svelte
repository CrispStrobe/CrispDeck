<script lang="ts">
  import { Heart, Repeat, MessageCircle, Quote, Bookmark, Share, Flag, Languages, Camera, Loader2, Volume2, VolumeOff, BarChart3, UserPlus, UserCheck } from '@lucide/svelte';
  import { addBookmark, removeBookmark, isBookmarked } from '$lib/bookmarks';
  import { translateText, type TranslationResult } from '$lib/translate';
  import { onMount, onDestroy } from 'svelte';
  import { jetstream } from '$lib/jetstream';
  import type { UnifiedPost } from '$lib/types';

  let { post, hideMedia = false, onlike, onboost, onreply, onquote }: {
    post: UnifiedPost;
    hideMedia?: boolean;
    onlike?: (post: UnifiedPost) => void;
    onboost?: (post: UnifiedPost) => void;
    onreply?: (post: UnifiedPost) => void;
    onquote?: (post: UnifiedPost) => void;
  } = $props();

  let liked = $state(false);
  let boosted = $state(false);
  let bookmarked = $state(false);
  let hideEngagement = $state(false);
  let showStats = $state(false);
  let following = $state(false);
  let unsubJetstream: (() => void) | null = null;

  onMount(async () => {
    bookmarked = await isBookmarked(post.uri);
    hideEngagement = localStorage.getItem('crispdeck-hide-engagement') === 'true';

    // Subscribe to real-time count updates for this post
    if (post.platform === 'bluesky') {
      jetstream.watchPost(post.uri);
      unsubJetstream = jetstream.subscribe((update) => {
        if (update.uri !== post.uri) return;
        if (update.type === 'like') localLikeCount += update.delta;
        if (update.type === 'repost') localBoostCount += update.delta;
      });
    }
  });

  onDestroy(() => {
    if (post.platform === 'bluesky') {
      jetstream.unwatchPost(post.uri);
    }
    unsubJetstream?.();
  });

  let copied = $state(false);

  // Read aloud (TTS)
  // Tries CrispASR TTS first (desktop), falls back to browser SpeechSynthesis.
  let speaking = $state(false);
  let audioEl: HTMLAudioElement | null = null;

  function getPostText(): string {
    const raw = post.platform === 'mastodon'
      ? (getMastodonHtml() || post.text).replace(/<[^>]*>/g, '')
      : post.text;
    return raw.trim();
  }

  async function toggleReadAloud() {
    if (speaking) {
      audioEl?.pause();
      speechSynthesis?.cancel();
      speaking = false;
      return;
    }

    const textToSpeak = getPostText();
    if (!textToSpeak) return;

    const engine = localStorage.getItem('crispdeck-tts-engine') ?? 'auto';

    // CrispASR TTS path (desktop/mobile with Tauri)
    const w = globalThis as any;
    if (engine !== 'browser' && w.__TAURI_INTERNALS__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const available = await invoke('asr_available') as boolean;
        if (available) {
          speaking = true;
          const ttsModel = localStorage.getItem('crispdeck-tts-model') || 'kokoro';
          const pcm = await invoke('synthesize_speech', {
            backend: ttsModel,
            modelPath: null,
            text: textToSpeak,
          }) as number[];

          // Play PCM as audio (24kHz mono float32 → WAV blob)
          const sampleRate = 24000;
          const buffer = new ArrayBuffer(44 + pcm.length * 2);
          const view = new DataView(buffer);
          // WAV header
          const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
          writeStr(0, 'RIFF');
          view.setUint32(4, 36 + pcm.length * 2, true);
          writeStr(8, 'WAVE');
          writeStr(12, 'fmt ');
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); // PCM
          view.setUint16(22, 1, true); // mono
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          writeStr(36, 'data');
          view.setUint32(40, pcm.length * 2, true);
          for (let i = 0; i < pcm.length; i++) {
            const s = Math.max(-1, Math.min(1, pcm[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          }
          const blob = new Blob([buffer], { type: 'audio/wav' });
          const url = URL.createObjectURL(blob);
          audioEl = new Audio(url);
          audioEl.onended = () => { speaking = false; URL.revokeObjectURL(url); };
          audioEl.onerror = () => { speaking = false; URL.revokeObjectURL(url); };
          audioEl.play();
          return;
        }
      } catch (e) {
        if (engine === 'crispasr') {
          speaking = false;
          console.error('CrispASR TTS failed:', e);
          return;
        }
        console.error('CrispASR TTS failed, falling back to browser:', e);
      }
    }

    if (engine === 'crispasr') {
      // User explicitly chose CrispASR but it's not available
      return;
    }

    // Fallback: browser SpeechSynthesis
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.onend = () => { speaking = false; };
    utterance.onerror = () => { speaking = false; };
    speechSynthesis.speak(utterance);
    speaking = true;
  }

  let translating = $state(false);
  let translation: TranslationResult | null = $state(null);
  let translateError = $state('');

  async function handleTranslate() {
    if (translation) { translation = null; return; } // Toggle off
    translating = true;
    translateError = '';
    try {
      const sourceText = post.platform === 'mastodon' ? getMastodonHtml() || post.text : post.text;
      translation = await translateText(sourceText);
    } catch (e) {
      translateError = String(e);
    } finally {
      translating = false;
    }
  }

  // Share as image
  let capturingImage = $state(false);
  let postEl: HTMLDivElement | undefined = $state();

  async function handleShareAsImage() {
    if (!postEl) return;
    capturingImage = true;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const canvas = await html2canvas(postEl, {
        backgroundColor: isDark ? '#1a1a2e' : '#f8fafc',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      // Add branding bar at bottom
      const brandCanvas = document.createElement('canvas');
      const brandHeight = 32;
      brandCanvas.width = canvas.width;
      brandCanvas.height = canvas.height + brandHeight;
      const ctx = brandCanvas.getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      ctx.fillStyle = isDark ? '#0f0f1a' : '#e2e8f0';
      ctx.fillRect(0, canvas.height, brandCanvas.width, brandHeight);
      ctx.fillStyle = isDark ? '#6b7280' : '#475569';
      ctx.font = `${12 * 2}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('shared via CrispDeck', brandCanvas.width / 2, canvas.height + brandHeight - 8);

      brandCanvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          if (navigator.share) {
            const file = new File([blob], 'post.png', { type: 'image/png' });
            await navigator.share({ files: [file] });
          } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'post.png';
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch { /* share cancelled */ }
      }, 'image/png');
    } catch (e) {
      console.error('Share as image failed:', e);
    } finally {
      capturingImage = false;
    }
  }

  async function votePoll(pollId: string, choiceIndex: number) {
    try {
      // Find the Mastodon instance from the post URI
      const url = new URL(post.uri);
      // We need a token — this requires the onlike callback pattern
      // For now, use a direct fetch (the token will come from the parent page)
      const raw = post.raw as any;
      const instanceUrl = `${url.protocol}//${url.hostname}`;
      const resp = await fetch(`${instanceUrl}/api/v1/polls/${pollId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [choiceIndex] }),
      });
      if (resp.ok) {
        // Update the poll in-place to show results
        const updated = await resp.json();
        (post.raw as any).poll = updated;
      }
    } catch (e) {
      console.error('Vote failed:', e);
    }
  }

  async function handleShare() {
    const url = getPostUrl(post);
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch {
      // Fallback
      window.open(url, '_blank');
    }
  }

  function handleReport() {
    const reason = prompt('Report reason (optional):');
    if (reason === null) return; // Cancelled
    // Open the post on the platform's web UI where reporting is handled
    const url = getPostUrl(post);
    window.open(url, '_blank');
    alert('To complete the report, use the platform\'s reporting tool on the opened page.');
  }

  async function handleBookmark() {
    if (bookmarked) {
      await removeBookmark(post.uri);
    } else {
      await addBookmark(post);
    }
    bookmarked = !bookmarked;
  }
  let localLikeCount = $state(post.likeCount ?? 0);
  let localBoostCount = $state(post.repostCount ?? 0);

  async function handleLike() {
    if (!onlike) return;
    liked = !liked;
    localLikeCount += liked ? 1 : -1;
    onlike(post);
  }

  async function handleBoost() {
    if (!onboost) return;
    boosted = !boosted;
    localBoostCount += boosted ? 1 : -1;
    onboost(post);
  }

  function formatDate(dateString?: string): string {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getProfileUrl(p: UnifiedPost): string {
    const h = encodeURIComponent(p.author.handle);
    return `/profile?handle=${h}&platform=${p.platform}`;
  }

  function getExternalProfileUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      const account = raw.reblog ? raw.reblog.account : raw.account;
      return account?.url ?? '#';
    }
    return `https://bsky.app/profile/${p.author.handle}`;
  }

  function getThreadUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      const id = raw.reblog?.id ?? raw.id ?? '';
      return `/thread?id=${id}&platform=mastodon`;
    }
    return `/thread?uri=${encodeURIComponent(p.uri)}&platform=bluesky`;
  }

  function getPostUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = p.raw as any;
      return (raw.reblog ? raw.reblog.url : p.uri) || p.uri;
    }
    const rkey = p.uri.split('/').pop();
    return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
  }

  function getMastodonHtml(): string {
    if (post.platform !== 'mastodon') return '';
    const raw = post.raw as any;
    return (raw.reblog ? raw.reblog.content : raw.content) ?? '';
  }

  function getMastodonMedia(): any[] {
    if (post.platform !== 'mastodon') return [];
    const raw = post.raw as any;
    const target = raw.reblog ?? raw;
    // Handle both camelCase (masto library) and snake_case (raw fetch)
    const sources = [
      post.embeds,
      target.mediaAttachments ?? target.media_attachments,
    ];
    for (const source of sources) {
      if (Array.isArray(source) && source.length > 0) {
        return source.filter((item: any) => item && item.type === 'image').map((item: any) => ({
          ...item,
          // Normalize to camelCase for template
          previewUrl: item.previewUrl ?? item.preview_url,
          remoteUrl: item.remoteUrl ?? item.remote_url,
        }));
      }
    }
    return [];
  }

  function getBskyImages(): any[] {
    if (post.platform !== 'bluesky' || !post.embeds) return [];
    const embed = post.embeds as any;
    if (embed.$type === 'app.bsky.embed.images#view' && embed.images) {
      return embed.images;
    }
    // Images inside recordWithMedia (quote + images)
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
      if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images) {
        return embed.media.images;
      }
    }
    return [];
  }

  function getBskyExternal(): any | null {
    if (post.platform !== 'bluesky' || !post.embeds) return null;
    const embed = post.embeds as any;
    // Direct external link
    if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
      return embed.external;
    }
    // External link inside recordWithMedia (quote + link card)
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
      if (embed.media.$type === 'app.bsky.embed.external#view' && embed.media.external) {
        return embed.media.external;
      }
    }
    return null;
  }

  function getBskyQuote(): any | null {
    if (post.platform !== 'bluesky' || !post.embeds) return null;
    const embed = post.embeds as any;
    // Direct quote
    if (embed.$type === 'app.bsky.embed.record#view' && embed.record) {
      const rec = embed.record;
      if (rec.$type === 'app.bsky.embed.record#viewRecord') {
        return rec;
      }
    }
    // Quote inside recordWithMedia
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record) {
      const rec = embed.record?.record;
      if (rec?.$type === 'app.bsky.embed.record#viewRecord') {
        return rec;
      }
    }
    return null;
  }

  function getBskyVideo(): any | null {
    if (post.platform !== 'bluesky' || !post.embeds) return null;
    const embed = post.embeds as any;
    if (embed.$type === 'app.bsky.embed.video#view') {
      return embed;
    }
    if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
      if (embed.media.$type === 'app.bsky.embed.video#view') {
        return embed.media;
      }
    }
    return null;
  }

  function getMastodonCard(): any | null {
    if (post.platform !== 'mastodon') return null;
    const raw = post.raw as any;
    const target = raw.reblog ?? raw;
    const card = target.card ?? target.preview_card;
    if (!card || !card.url) return null;
    // Don't show card if there are media attachments (images take priority)
    const media = target.mediaAttachments ?? target.media_attachments ?? [];
    if (Array.isArray(media) && media.length > 0) return null;
    // Normalize snake_case to camelCase
    return {
      ...card,
      provider_name: card.provider_name ?? card.providerName,
    };
  }

  const mastodonCard = $derived(getMastodonCard());
  const mastodonMedia = $derived(getMastodonMedia());
  const bskyImages = $derived(getBskyImages());
  const bskyExternal = $derived(getBskyExternal());
  const bskyQuote = $derived(getBskyQuote());
  const bskyVideo = $derived(getBskyVideo());
  const mastodonHtml = $derived(getMastodonHtml());
  const platformColor = $derived(`var(--color-${post.platform})`);

  // Labels on Bluesky posts
  const postLabels = $derived(() => {
    if (post.platform !== 'bluesky') return [];
    const raw = post.raw as any;
    const labels = raw?.post?.labels ?? raw?.labels ?? [];
    return labels.filter((l: any) => !l.neg).map((l: any) => l.val);
  });

  // Check label preferences
  function shouldWarnLabel(label: string): boolean {
    const prefs = JSON.parse(localStorage.getItem('crispdeck-label-prefs') ?? '{}');
    return prefs[label] === 'warn' || (!prefs[label] && ['porn', 'sexual', 'graphic-media', 'nudity'].includes(label));
  }

  function shouldHideLabel(label: string): boolean {
    const prefs = JSON.parse(localStorage.getItem('crispdeck-label-prefs') ?? '{}');
    return prefs[label] === 'hide';
  }

  const hiddenByLabel = $derived(postLabels().some(shouldHideLabel));
  const warnedLabels = $derived(postLabels().filter(shouldWarnLabel));
  let labelRevealed = $state(false);
</script>

{#if hiddenByLabel && !labelRevealed}
  <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
    <p class="text-xs text-[var(--color-text-muted)]">Content hidden: {postLabels().join(', ')}</p>
    <button onclick={() => labelRevealed = true} class="text-xs text-[var(--color-primary)] hover:underline mt-1">Show anyway</button>
  </div>
{:else}
<div bind:this={postEl} class="group p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
  <!-- Label warnings -->
  {#if warnedLabels.length > 0 && !labelRevealed}
    <div class="mb-2 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-xs text-yellow-300 flex items-center justify-between">
      <span>Content warning: {warnedLabels.join(', ')}</span>
      <button onclick={() => labelRevealed = true} class="text-yellow-400 hover:underline ml-2">Show</button>
    </div>
  {/if}

  <!-- Label badges -->
  {#if postLabels().length > 0}
    <div class="mb-2 flex items-center gap-1 flex-wrap">
      {#each postLabels() as label}
        <span class="text-[9px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded">{label}</span>
      {/each}
    </div>
  {/if}
  {#if post.isRepost && post.repostAuthor}
    <div class="text-sm text-[var(--color-text-muted)] flex items-center gap-2 mb-2">
      <Repeat size={14} />
      <span>Reposted by {post.repostAuthor.displayName || post.repostAuthor.handle}</span>
    </div>
  {/if}

  <div class="flex items-start gap-3">
    <div class="relative group/avatar">
      <a href={getProfileUrl(post)}>
        {#if post.author.avatar}
          <img loading="lazy" src={post.author.avatar} alt="" class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)]" />
        {:else}
          <div class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            {post.author.handle.charAt(0).toUpperCase()}
          </div>
        {/if}
      </a>
      <button
        onclick|stopPropagation={() => { following = !following; }}
        class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center transition-all opacity-0 group-hover/avatar:opacity-100 {following ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-primary)] text-white'}"
        title={following ? 'Following' : 'Follow'}
        aria-label={following ? `Unfollow ${post.author.handle}` : `Follow ${post.author.handle}`}
      >
        {#if following}<UserCheck size={10} />{:else}<UserPlus size={10} />{/if}
      </button>
    </div>
    <div class="flex-1 min-w-0">
      <a href={getProfileUrl(post)} class="flex items-center gap-2 mb-1 group">
        <span class="font-semibold text-[var(--color-text)] group-hover:underline truncate text-sm">
          {post.author.displayName || post.author.handle}
        </span>
        <span class="text-[var(--color-text-muted)] text-xs truncate">{post.author.handle}</span>
        <span class="w-2 h-2 rounded-full flex-shrink-0" style="background: {platformColor}"></span>
      </a>
      <a href={getThreadUrl(post)} class="block min-w-0 hover:bg-[var(--color-surface-hover)]/30 rounded -mx-1 px-1 transition-colors">
        {#if post.platform === 'mastodon' && mastodonHtml}
          <div class="text-sm text-[var(--color-text)] break-words prose-invert [&_a]:text-blue-400 [&_a]:hover:underline">
            {@html mastodonHtml}
          </div>
        {:else}
          <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{post.text}</p>
        {/if}
      </a>
    </div>
  </div>

  <!-- Translation -->
  {#if translation}
    <div class="mt-2 pl-13 p-2 bg-blue-950/20 border border-blue-900/30 rounded-md">
      <p class="text-sm text-[var(--color-text)] whitespace-pre-wrap break-words">{translation.translated}</p>
      <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
        Translated from {translation.sourceLang} · {translation.provider}
      </p>
    </div>
  {/if}
  {#if translateError}
    <p class="mt-1 pl-13 text-[10px] text-red-400">{translateError}</p>
  {/if}

  {#if !hideMedia}
    <div class="mt-2 pl-13">
      <!-- Bluesky images -->
      {#if bskyImages.length > 0}
        <div class="grid grid-cols-2 gap-2 pt-2">
          {#each bskyImages as image}
            <a href={image.fullsize} target="_blank" rel="noopener noreferrer">
              <img loading="lazy" src={image.thumb} alt={image.alt || ''} class="rounded-md w-full aspect-video object-cover" />
            </a>
          {/each}
        </div>
      {/if}

      <!-- Bluesky external link -->
      {#if bskyExternal}
        <a href={bskyExternal.uri} target="_blank" rel="noopener noreferrer" class="mt-2 block border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
          {#if bskyExternal.thumb}
            <img loading="lazy" src={bskyExternal.thumb} alt="" class="w-full h-32 object-cover" />
          {/if}
          <div class="p-3">
            <p class="text-xs text-[var(--color-text-muted)]">{new URL(bskyExternal.uri).hostname}</p>
            <p class="font-semibold text-sm text-[var(--color-text)]">{bskyExternal.title}</p>
            {#if bskyExternal.description}
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-2">{bskyExternal.description}</p>
            {/if}
          </div>
        </a>
      {/if}

      <!-- Bluesky quoted post -->
      {#if bskyQuote}
        <div class="mt-2 border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)]">
          <div class="flex items-center gap-2 mb-1">
            {#if bskyQuote.author?.avatar}
              <img loading="lazy" src={bskyQuote.author.avatar} alt="" class="w-4 h-4 rounded-full" />
            {/if}
            <span class="text-xs font-medium">{bskyQuote.author?.displayName || bskyQuote.author?.handle}</span>
            <span class="text-[10px] text-[var(--color-text-muted)]">@{bskyQuote.author?.handle}</span>
          </div>
          <p class="text-xs text-[var(--color-text-muted)] line-clamp-3">{(bskyQuote.value as any)?.text ?? ''}</p>
          {#if bskyQuote.embeds?.[0]}
            {@const qEmbed = bskyQuote.embeds[0]}
            {#if qEmbed.$type === 'app.bsky.embed.images#view' && qEmbed.images?.[0]}
              <img loading="lazy" src={qEmbed.images[0].thumb} alt={qEmbed.images[0].alt || ''} class="mt-1.5 rounded w-full h-24 object-cover" />
            {/if}
            {#if qEmbed.$type === 'app.bsky.embed.external#view' && qEmbed.external}
              <div class="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                {#if qEmbed.external.thumb}
                  <img loading="lazy" src={qEmbed.external.thumb} alt="" class="w-10 h-10 rounded object-cover" />
                {/if}
                <div class="min-w-0">
                  <p class="font-medium truncate">{qEmbed.external.title}</p>
                  <p class="truncate">{new URL(qEmbed.external.uri).hostname}</p>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {/if}

      <!-- Bluesky video -->
      {#if bskyVideo}
        <div class="mt-2 rounded-lg overflow-hidden border border-[var(--color-border)]">
          {#if bskyVideo.thumbnail}
            <div class="relative">
              <img loading="lazy" src={bskyVideo.thumbnail} alt={bskyVideo.alt || 'Video'} class="w-full aspect-video object-cover" />
              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-12 h-12 bg-black/60 rounded-full flex items-center justify-center">
                  <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
            </div>
          {/if}
          {#if bskyVideo.alt}
            <p class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">{bskyVideo.alt}</p>
          {/if}
        </div>
      {/if}

      <!-- Mastodon images -->
      {#if mastodonMedia.length > 0}
        <div class="grid grid-cols-2 gap-2 pt-2">
          {#each mastodonMedia as attachment, i}
            {@const imageUrl = attachment.previewUrl || attachment.url || attachment.remoteUrl}
            {#if imageUrl}
              <a href={attachment.url || imageUrl} target="_blank" rel="noopener noreferrer">
                <img loading="lazy" src={imageUrl} alt={attachment.description || `Image ${i + 1}`} class="rounded-md w-full aspect-video object-cover bg-[var(--color-surface-hover)]" />
              </a>
            {/if}
          {/each}
        </div>
      {/if}

      <!-- Mastodon link card -->
      {#if mastodonCard}
        <a href={mastodonCard.url} target="_blank" rel="noopener noreferrer" class="mt-2 block border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
          {#if mastodonCard.image}
            <img loading="lazy" src={mastodonCard.image} alt="" class="w-full h-32 object-cover" />
          {/if}
          <div class="p-3">
            <p class="text-xs text-[var(--color-text-muted)]">{mastodonCard.provider_name || new URL(mastodonCard.url).hostname}</p>
            <p class="font-semibold text-sm text-[var(--color-text)]">{mastodonCard.title}</p>
            {#if mastodonCard.description}
              <p class="text-xs text-[var(--color-text-muted)] line-clamp-2">{mastodonCard.description}</p>
            {/if}
          </div>
        </a>
      {/if}

      <!-- Mastodon poll -->
      {#if post.platform === 'mastodon' && (post.raw as any)?.poll}
        {@const poll = (post.raw as any).poll}
        {@const hasVoted = poll.voted || poll.ownVotes?.length > 0}
        <div class="mt-2 space-y-1.5">
          {#each poll.options as option, i}
            {@const total = poll.votesCount || poll.options.reduce((s: number, o: any) => s + (o.votesCount ?? 0), 0) || 1}
            {@const pct = Math.round(((option.votesCount ?? 0) / total) * 100)}
            {@const isMyVote = poll.ownVotes?.includes(i)}
            {#if hasVoted || poll.expired}
              <div class="relative overflow-hidden rounded-md border border-[var(--color-border)] {isMyVote ? 'border-[var(--color-primary)]' : ''}">
                <div class="absolute inset-0 bg-[var(--color-primary)]/15" style="width: {pct}%"></div>
                <div class="relative flex items-center justify-between px-3 py-1.5">
                  <span class="text-xs">{isMyVote ? '✓ ' : ''}{option.title}</span>
                  <span class="text-[10px] text-[var(--color-text-muted)] font-medium">{pct}%</span>
                </div>
              </div>
            {:else}
              <button
                onclick={() => votePoll(poll.id, i)}
                class="w-full text-left px-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors"
              >
                {option.title}
              </button>
            {/if}
          {/each}
          <p class="text-[10px] text-[var(--color-text-muted)]">
            {poll.votesCount ?? '?'} votes · {poll.expired ? 'Closed' : hasVoted ? 'Voted' : 'Open'}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex items-center justify-between mt-3 pl-13">
    <div class="flex items-center gap-4">
      {#if onreply}
        <button onclick={() => onreply?.(post)} class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-blue-400 transition-colors" title="Reply" aria-label="Reply ({post.replyCount ?? 0} replies)">
          <MessageCircle size={14} />
          {#if !hideEngagement}<span class="text-xs">{post.replyCount ?? 0}</span>{/if}
        </button>
      {:else}
        <div class="flex items-center gap-1.5 text-[var(--color-text-muted)]" aria-label="{post.replyCount ?? 0} replies">
          <MessageCircle size={14} />
          {#if !hideEngagement}<span class="text-xs">{post.replyCount ?? 0}</span>{/if}
        </div>
      {/if}

      <button
        onclick={handleBoost}
        disabled={!onboost}
        class="flex items-center gap-1.5 transition-colors {boosted ? 'text-green-400' : 'text-[var(--color-text-muted)]'} {onboost ? 'hover:text-green-400' : ''}"
        title="Boost"
        aria-label="{boosted ? 'Undo boost' : 'Boost'} ({localBoostCount} boosts)"
        aria-pressed={boosted}
      >
        <Repeat size={14} />
        {#if !hideEngagement}<span class="text-xs">{localBoostCount}</span>{/if}
      </button>

      {#if onquote}
        <button
          onclick={() => onquote?.(post)}
          class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-purple-400 transition-colors"
          title="Quote"
          aria-label="Quote post"
        >
          <Quote size={14} />
        </button>
      {/if}

      <button
        onclick={handleLike}
        disabled={!onlike}
        class="flex items-center gap-1.5 transition-colors {liked ? 'text-red-400' : 'text-[var(--color-text-muted)]'} {onlike ? 'hover:text-red-400' : ''}"
        title="Like"
        aria-label="{liked ? 'Unlike' : 'Like'} ({localLikeCount} likes)"
        aria-pressed={liked}
      >
        <Heart size={14} class={liked ? 'fill-current' : ''} />
        {#if !hideEngagement}<span class="text-xs">{localLikeCount}</span>{/if}
      </button>

      <button
        onclick={handleBookmark}
        class="flex items-center gap-1.5 transition-colors {bookmarked ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'} hover:text-yellow-400"
        title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this post'}
        aria-pressed={bookmarked}
      >
        <Bookmark size={14} class={bookmarked ? 'fill-current' : ''} />
      </button>

      <button
        onclick={handleShare}
        class="flex items-center gap-1.5 transition-colors {copied ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'} hover:text-[var(--color-text)]"
        title={copied ? 'Copied!' : 'Copy link'}
        aria-label="Copy link to post"
      >
        <Share size={14} />
      </button>

      <button
        onclick={toggleReadAloud}
        class="flex items-center gap-1.5 transition-colors {speaking ? 'text-green-400' : 'text-[var(--color-text-muted)]'} hover:text-green-400 opacity-0 group-hover:opacity-100"
        title={speaking ? 'Stop reading' : 'Read aloud'}
        aria-label={speaking ? 'Stop reading aloud' : 'Read post aloud'}
        aria-pressed={speaking}
      >
        {#if speaking}<VolumeOff size={12} />{:else}<Volume2 size={12} />{/if}
      </button>

      <button
        onclick={handleTranslate}
        disabled={translating}
        class="flex items-center gap-1.5 transition-colors {translation ? 'text-blue-400' : 'text-[var(--color-text-muted)]'} hover:text-blue-400 opacity-0 group-hover:opacity-100"
        title={translation ? 'Hide translation' : 'Translate'}
        aria-label={translation ? 'Hide translation' : 'Translate post'}
      >
        {#if translating}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <Languages size={12} />
        {/if}
      </button>

      <button
        onclick={handleShareAsImage}
        disabled={capturingImage}
        class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors opacity-0 group-hover:opacity-100"
        title="Share as image"
        aria-label="Share post as image"
      >
        {#if capturingImage}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <Camera size={12} />
        {/if}
      </button>

      <button
        onclick={() => showStats = !showStats}
        class="flex items-center gap-1.5 transition-colors {showStats ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'} hover:text-[var(--color-primary)] opacity-0 group-hover:opacity-100"
        title="Post statistics"
        aria-label="Show post statistics"
        aria-pressed={showStats}
      >
        <BarChart3 size={12} />
      </button>

      <button
        onclick={handleReport}
        class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors opacity-0 group-hover:opacity-100"
        title="Report"
        aria-label="Report post"
      >
        <Flag size={12} />
      </button>
    </div>
    <a href={getPostUrl(post)} target="_blank" rel="noopener noreferrer" class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline">
      {formatDate(post.createdAt)}
    </a>
  </div>

  <!-- Post statistics overlay -->
  {#if showStats}
    {@const totalEngagement = (post.likeCount ?? 0) + (post.repostCount ?? 0) + (post.replyCount ?? 0)}
    {@const engagementRate = totalEngagement > 0 ? 100 : 0}
    <div class="mt-3 pl-13 p-3 bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] space-y-2">
      <div class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <BarChart3 size={12} />
        <span class="font-medium">Engagement breakdown</span>
        <span class="ml-auto text-[10px]">{post.platform}</span>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-red-400">{post.likeCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Likes</div>
        </div>
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-green-400">{post.repostCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Reposts</div>
        </div>
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-blue-400">{post.replyCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Replies</div>
        </div>
      </div>
      <div class="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>Total engagement: {totalEngagement}</span>
        {#if totalEngagement > 0}
          {@const likesPct = Math.round(((post.likeCount ?? 0) / totalEngagement) * 100)}
          {@const repostsPct = Math.round(((post.repostCount ?? 0) / totalEngagement) * 100)}
          {@const repliesPct = 100 - likesPct - repostsPct}
          <div class="flex items-center gap-0.5 w-24 h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
            <div class="h-full bg-red-400 rounded-l-full" style="width: {likesPct}%"></div>
            <div class="h-full bg-green-400" style="width: {repostsPct}%"></div>
            <div class="h-full bg-blue-400 rounded-r-full" style="width: {repliesPct}%"></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
{/if}
