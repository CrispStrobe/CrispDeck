<script module lang="ts">
  /**
   * Post preferences, read once per session rather than once per post.
   *
   * This lived in the instance <script>, which in Svelte 5 runs for every
   * component instance — so the "cache" was per-instance and re-read
   * localStorage three times for every post rendered, and the invalidation
   * listener was registered again for every post and never removed. Ten Post
   * instances produced ten listeners and thirty localStorage reads; a deck of
   * eight columns holds several hundred, all still attached after the posts
   * scroll away, and all firing on each settings change.
   *
   * <script module> runs once for the module, which is what the original
   * comment described and what the code now does.
   */
  let _postPrefsCache: { hideEngagement: boolean; mediaPreview: 'lightbox' | 'browser'; compact: boolean } | null = null;

  export function getPostPrefs() {
    if (_postPrefsCache) return _postPrefsCache;
    _postPrefsCache = {
      hideEngagement: localStorage.getItem('crispdeck-hide-engagement') === 'true',
      mediaPreview: (localStorage.getItem('crispdeck-media-preview') as 'lightbox' | 'browser') || 'lightbox',
      compact: localStorage.getItem('crispdeck-compact-posts') === 'true',
    };
    return _postPrefsCache;
  }

  // One listener for the module, not one per post. Nothing to remove: it
  // lives as long as the module does.
  if (typeof window !== 'undefined') {
    window.addEventListener('crispdeck:prefs-changed', () => { _postPrefsCache = null; });
  }
</script>

<script lang="ts">
  import * as embeds from '$lib/components/post-embeds';
  import { readJson } from '$lib/safe-storage';
  import { hrefOrHash, safeExternalUrl } from '$lib/safe-url';
  import { openExternalLink } from '$lib/external-link';
  import { replyContext } from '$lib/reply-context';
  import { hasAltText } from '$lib/alt-text';
  import { formatDate, relativeTime } from '$lib/time-format';
  import { i18n } from '$lib/i18n.svelte';
  import { base } from '$app/paths';
  import { Heart, Repeat, MessageCircle, Quote, Bookmark, Share, Flag, Languages, Camera, Loader2, Volume2, VolumeOff, BarChart3, UserPlus, UserCheck, Pin, ListPlus, X as XIcon } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import { isPinned, pinPost, unpinPost } from '$lib/pinned-posts';
  import { addBookmark, removeBookmark, isBookmarked } from '$lib/bookmarks';
  import { listReadingLists, addPostToList, type ReadingList } from '$lib/reading-lists';
  import { createBlueskyBookmark, deleteBlueskyBookmark } from '$lib/api/bluesky-bookmarks';
  import { initAllClients, getBskyAgent } from '$lib/api/client-factory';
  import { translateText, type TranslationResult } from '$lib/translate';
  import { onMount, onDestroy } from 'svelte';
  import { jetstream } from '$lib/jetstream';
  import type { UnifiedPost } from '$lib/types';
  import { sanitizeHtml, injectCustomEmoji } from '$lib/sanitize';
  import MediaLightbox from '$lib/components/MediaLightbox.svelte';
  import BlueskyVideo from '$lib/components/BlueskyVideo.svelte';
  import { haptic } from '$lib/haptics';
  import { toast } from '$lib/toast.svelte';
  import { swallow } from '$lib/debug-log';
  import type { LightboxItem } from '$lib/components/MediaLightbox.svelte';

  const _postPrefs = getPostPrefs();

  let { post, hideMedia = false, compact = false, feedPreview = false, onlike, onboost, onreply, onquote, onfollow }: {
    post: UnifiedPost;
    hideMedia?: boolean;
    compact?: boolean;
    feedPreview?: boolean;
    /** May reject to signal the action failed; the optimistic update is then reverted. */
    onlike?: (post: UnifiedPost) => void | Promise<void>;
    onboost?: (post: UnifiedPost) => void | Promise<void>;
    onreply?: (post: UnifiedPost) => void;
    onquote?: (post: UnifiedPost) => void;
    onfollow?: (post: UnifiedPost, following: boolean) => void;
  } = $props();

  let previewElement: HTMLDivElement | undefined = $state();
  let previewContent: HTMLDivElement | undefined = $state();
  let previewExpanded = $state(false);
  let previewClipped = $state(false);
  $effect(() => {
    if (!feedPreview || !previewElement || !previewContent || typeof ResizeObserver === 'undefined') return;
    const box = previewElement;
    const content = previewContent;
    const measure = () => { previewClipped = !previewExpanded && content.scrollHeight > box.clientHeight + 1; };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  });

  let liked = $state(false);
  let likeAnimating = $state(false);
  let boosted = $state(false);
  // Optimistic/live offsets applied on top of the server counts below.
  let likeDelta = $state(0);
  let boostDelta = $state(0);
  let bookmarked = $state(false);
  let hideEngagement = $state(false);
  let showStats = $state(false);
  let following = $state(false);
  let pinned = $state(false);
  let showListPicker = $state(false);
  let readingLists: ReadingList[] = $state([]);

  function openListPicker() {
    readingLists = listReadingLists();
    showListPicker = true;
  }

  function addToList(listId: string) {
    addPostToList(listId, post);
    showListPicker = false;
  }

  // Media lightbox
  let lightboxItems: LightboxItem[] = $state([]);
  let lightboxIndex: number | null = $state(null);
  let mediaPreviewMode = $state<'lightbox' | 'browser'>('lightbox');

  function openLightbox(items: LightboxItem[], index: number) {
    if (mediaPreviewMode === 'browser' && items.length === 1) {
      window.open(items[index].url, '_blank', 'noopener,noreferrer');
      return;
    }
    lightboxItems = items;
    lightboxIndex = index;
  }

  function closeLightbox() {
    lightboxIndex = null;
    lightboxItems = [];
  }

  function scrollMedia(event: MouseEvent, direction: number) {
    const container = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('.media-strip');
    container?.scrollBy({ left: direction * container.clientWidth * 0.5, behavior: 'smooth' });
  }

  function handlePin() {
    if (pinned) { unpinPost(post.uri); pinned = false; }
    else { pinPost(post); pinned = true; }
  }
  // Per-URI Jetstream listener — only fires for this post's URI (no broadcast filtering)
  const jetstreamListener = (update: import('$lib/jetstream').CountUpdate) => {
    if (update.type === 'like') likeDelta += update.delta;
    if (update.type === 'repost') boostDelta += update.delta;
  };

  onMount(async () => {
    bookmarked = await isBookmarked(post.uri);
    pinned = isPinned(post.uri);
    hideEngagement = _postPrefs.hideEngagement;
    mediaPreviewMode = _postPrefs.mediaPreview;
    if (!compact) compact = _postPrefs.compact;

    // Register per-URI listener for real-time count updates
    if (post.platform === 'bluesky') {
      jetstream.watchPost(post.uri, jetstreamListener);
    }
  });

  onDestroy(() => {
    if (post.platform === 'bluesky') {
      jetstream.unwatchPost(post.uri, jetstreamListener);
    }
    if (audioEl) {
      audioEl.pause();
      if (audioEl.src?.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
      audioEl = null;
    }
  });

  let copied = $state(false);

  // Read aloud (TTS)
  // Tries CrispASR TTS first (desktop), falls back to browser SpeechSynthesis.
  let speaking = $state(false);
  let audioEl: HTMLAudioElement | null = null;

  function getPostText(): string {
    const raw = post.platform === 'mastodon'
      ? (mastodonHtml || post.text).replace(/<[^>]*>/g, '')
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
          swallow('Post.tts:crispasr', e);
          toast.error(i18n.t.post.ttsFailed);
          return;
        }
        // Not final — the browser's speechSynthesis is tried next.
        swallow('Post.tts:fallback', e);
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
      // Try Mastodon server-side translation first (free, private)
      if (post.platform === 'mastodon') {
        const raw = (post.raw ?? {}) as any;
        const statusId = raw?.id ?? raw?.reblog?.id;
        const instanceUrl = raw?.uri ? new URL(raw.uri).origin : null;
        if (statusId && instanceUrl) {
          try {
            const resp = await fetch(`${instanceUrl}/api/v1/statuses/${statusId}/translate`, { method: 'POST' });
            if (resp.ok) {
              const data = await resp.json();
              if (data.content) {
                translation = { translated: data.content.replace(/<[^>]*>/g, ''), sourceLang: data.detected_source_language ?? '', provider: 'Instance' };
                return;
              }
            }
          } catch { /* fall through to client-side */ }
        }
      }
      const sourceText = post.platform === 'mastodon' ? mastodonHtml || post.text : post.text;
      translation = await translateText(sourceText);
    } catch (e) {
      translateError = String(e);
      toast.error(i18n.t.post.translationFailed);
    } finally {
      translating = false;
    }
  }

  // Share as image
  let capturingImage = $state(false);
  let shareError = $state('');
  // HTMLElement, not HTMLDivElement: the wrapper is an <article> now.
  let postEl: HTMLElement | undefined = $state();

  async function handleShareAsImage() {
    if (!postEl) return;
    capturingImage = true;
    shareError = '';
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
      swallow('Post.shareAsImage', e);
      shareError = `Share failed: ${e instanceof Error ? e.message : 'Unknown error'}. Cross-origin images may block capture.`;
      setTimeout(() => { shareError = ''; }, 5000);
    } finally {
      capturingImage = false;
    }
  }

  let voteError = $state('');
  async function votePoll(pollId: string, choiceIndex: number) {
    voteError = '';
    try {
      // Get Mastodon client for auth token
      const { accounts: accts, clients } = await initAllClients();
      const mastoAcct = accts.find(a => a.platform === 'mastodon');
      const mastoEntry = mastoAcct ? clients.get(mastoAcct.id) : undefined;
      const mastoClient = mastoEntry?.client as any;
      const token = mastoClient?.getAccessToken?.();
      const instanceUrl = mastoClient?.getInstanceUrl?.();

      if (!token || !instanceUrl) {
        voteError = 'No Mastodon account connected';
        toast.error(i18n.t.post.needMastodonToVote);
        return;
      }

      try {
        const updated = await mastoClient.votePoll(pollId, [choiceIndex]);
        ((post.raw ?? {}) as any).poll = updated;
        toast.success(i18n.t.post.voteRecorded);
      } catch (err) {
        voteError = String(err instanceof Error ? err.message : err);
        toast.error(voteError);
      }
    } catch (e) {
      voteError = String(e);
      toast.error(i18n.t.post.voteFailed);
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
    const reason = prompt(i18n.t.post.reportReason);
    if (reason === null) return; // Cancelled
    // Open the post on the platform's web UI where reporting is handled
    const url = getPostUrl(post);
    window.open(url, '_blank');
    alert(i18n.t.post.reportHint);
  }

  async function handleBookmark() {
    try {
      if (bookmarked) {
        await removeBookmark(post.uri);
      } else {
        await addBookmark(post);
      }
      bookmarked = !bookmarked;
    } catch (e) {
      swallow('Post.handleBookmark', e);
      toast.error(i18n.t.post.bookmarkFailed);
      return;
    }
    // Best-effort write-through to Bluesky's official server-side bookmarks
    // (app.bsky.bookmark.*) — local bookmark stands even if this fails.
    if (post.platform === 'bluesky' && post.uri.startsWith('at://')) {
      try {
        const { clients } = await initAllClients();
        const agent = getBskyAgent(clients);
        if (!agent) return;
        if (bookmarked) {
          const cid = (post.raw as any)?.post?.cid;
          if (cid) await createBlueskyBookmark(agent, post.uri, cid);
        } else {
          await deleteBlueskyBookmark(agent, post.uri);
        }
      } catch (e) {
        swallow('Post.bookmarkServerSync', e);
        toast.warning(i18n.t.post.savedLocallyOnly);
      }
    }
  }
  // Server count + our offset, not a $state seeded from `post`: the feed keys
  // rows by URI, so a refresh reuses this component instance and a seeded copy
  // would stay frozen at whatever the count was when the row first rendered.
  const localLikeCount = $derived(Math.max(0, (post.likeCount ?? 0) + likeDelta));
  const localBoostCount = $derived(Math.max(0, (post.repostCount ?? 0) + boostDelta));

  /**
   * Like, optimistically — and put it back if the network disagrees.
   *
   * The heart fills, the count moves and the phone buzzes before the request
   * is made, which is right: waiting on a round trip to acknowledge a tap feels
   * broken. What was missing is the other half. The call was fired and not
   * awaited, so a failure left the post looking liked when it was not, and the
   * only trace was a console line the user was never going to see.
   */
  async function handleLike() {
    if (!onlike) return;
    const previouslyLiked = liked;
    const applied = !liked ? 1 : -1;

    liked = !liked;
    likeDelta += applied;
    haptic('light');
    if (liked) { likeAnimating = true; setTimeout(() => likeAnimating = false, 600); }

    try {
      await onlike(post);
    } catch (e) {
      liked = previouslyLiked;
      likeDelta -= applied;
      likeAnimating = false;
      toast.error(i18n.t.post.likeFailed);
      swallow('Post.handleLike', e);
    }
  }

  /** Repost, with the same optimistic-then-revert contract as handleLike. */
  async function handleBoost() {
    if (!onboost) return;
    const previouslyBoosted = boosted;
    const applied = !boosted ? 1 : -1;

    boosted = !boosted;
    boostDelta += applied;
    haptic('medium');

    try {
      await onboost(post);
    } catch (e) {
      boosted = previouslyBoosted;
      boostDelta -= applied;
      toast.error(i18n.t.post.boostFailed);
      swallow('Post.handleBoost', e);
    }
  }



  function getProfileUrl(p: UnifiedPost): string {
    const h = encodeURIComponent(p.author.handle);
    return `${base}/profile?handle=${h}&platform=${p.platform}`;
  }

  function getExternalProfileUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = (p.raw ?? {}) as any;
      const account = raw.reblog ? raw.reblog.account : raw.account;
      // A Mastodon account URL is whatever the remote instance reports.
      return hrefOrHash(account?.url);
    }
    return `https://bsky.app/profile/${p.author.handle}`;
  }

  function getThreadUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = (p.raw ?? {}) as any;
      const id = raw.reblog?.id ?? raw.id ?? '';
      return `${base}/thread?id=${id}&platform=mastodon`;
    }
    if (p.platform === 'threads') {
      return `${base}/thread?uri=${encodeURIComponent(p.uri)}&platform=threads`;
    }
    return `${base}/thread?uri=${encodeURIComponent(p.uri)}&platform=bluesky`;
  }

  function getPostUrl(p: UnifiedPost): string {
    if (p.platform === 'mastodon') {
      const raw = (p.raw ?? {}) as any;
      return (raw.reblog ? raw.reblog.url : p.uri) || p.uri;
    }
    const rkey = p.uri.split('/').pop();
    return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
  }

  function getMastodonHtml(): string {
    if (post.platform !== 'mastodon') return '';
    const raw = (post.raw ?? {}) as any;
    return (raw.reblog ? raw.reblog.content : raw.content) ?? '';
  }

  /** Render Bluesky post text with facets (mentions, links, hashtags) as HTML */
  function getBskyHtml(): string {
    if (post.platform !== 'bluesky') return '';
    const raw = (post.raw ?? {}) as any;
    const record = raw?.post?.record;
    const text: string = record?.text ?? post.text;
    const facets: any[] = record?.facets;
    if (!facets || facets.length === 0) {
      // No facets — still linkify URLs and @handles with regex
      return linkifyPlainText(text);
    }

    // Convert string to byte array for correct facet indexing (Bluesky uses UTF-8 byte offsets)
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const bytes = encoder.encode(text);

    // Sort facets by byte start
    const sorted = [...facets].sort((a, b) => (a.index?.byteStart ?? 0) - (b.index?.byteStart ?? 0));

    let result = '';
    let lastEnd = 0;

    for (const facet of sorted) {
      const start = facet.index?.byteStart ?? 0;
      const end = facet.index?.byteEnd ?? 0;
      if (start < lastEnd || end > bytes.length) continue;

      // Text before this facet
      result += escapeHtml(decoder.decode(bytes.slice(lastEnd, start)));

      const segment = decoder.decode(bytes.slice(start, end));
      const feature = facet.features?.[0];

      if (feature?.$type === 'app.bsky.richtext.facet#link') {
        // escapeHtml keeps the URI inside the attribute; it says nothing
        // about the scheme, and href="javascript:..." runs on click.
        const safe = safeExternalUrl(feature.uri);
        result += safe
          ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segment)}</a>`
          : escapeHtml(segment);
      } else if (feature?.$type === 'app.bsky.richtext.facet#mention') {
        result += `<a href="{base}/profile?handle=${encodeURIComponent(feature.did)}&platform=bluesky" data-mention="${escapeHtml(feature.did)}">${escapeHtml(segment)}</a>`;
      } else if (feature?.$type === 'app.bsky.richtext.facet#tag') {
        result += `<a href="{base}/search?q=${encodeURIComponent('#' + feature.tag)}" data-tag="${escapeHtml(feature.tag)}">${escapeHtml(segment)}</a>`;
      } else {
        result += escapeHtml(segment);
      }
      lastEnd = end;
    }

    // Remaining text after last facet
    result += escapeHtml(decoder.decode(bytes.slice(lastEnd)));
    return result;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Linkify URLs and @handles in plain text (fallback when no facets) */
  function linkifyPlainText(text: string): string {
    return escapeHtml(text)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/@([\w.-]+\.[\w.-]+)/g, (match, handle) => {
        return `<a href="{base}/profile?handle=${encodeURIComponent(handle)}&platform=bluesky" data-mention="${escapeHtml(handle)}">${match}</a>`;
      });
  }

  /** Intercept clicks on links in post HTML — route hashtags, handles, and in-app links */
  // Also reached from the keyboard path below; only target/preventDefault/
  // stopPropagation are used, which both event types carry.
  function handlePostLinkClick(e: MouseEvent | KeyboardEvent) {
    const target = (e.target as HTMLElement).closest('a');
    if (!target || !(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute('href');
    if (!href) return;

    // In-app links (mentions, tags, profiles) — href starts with /
    if (href.startsWith('/')) {
      e.preventDefault();
      e.stopPropagation();
      goto(href);
      return;
    }

    try {
      const url = new URL(href);

      // Hashtag: https://instance/tags/tagname
      const tagMatch = url.pathname.match(/^\/tags\/(.+)$/);
      if (tagMatch) {
        e.preventDefault();
        e.stopPropagation();
        goto(`${base}/search?q=${encodeURIComponent('#' + decodeURIComponent(tagMatch[1]))}`);
        return;
      }

      // Handle: https://instance/@user or https://instance/@user@otherinstance
      const handleMatch = url.pathname.match(/^\/@([^/]+)$/);
      if (handleMatch) {
        e.preventDefault();
        e.stopPropagation();
        const handle = decodeURIComponent(handleMatch[1]);
        const fullHandle = handle.includes('@') ? handle : `${handle}@${url.hostname}`;
        goto(`${base}/profile?handle=${encodeURIComponent(fullHandle)}`);
        return;
      }
    } catch {
      // Not a valid URL — let it pass through to browser
    }
    if (e instanceof MouseEvent) openExternalLink(e, href, () => toast.error(i18n.t.post.openLinkFailed));
  }

  function getMastodonMedia(): any[] {
    if (post.platform !== 'mastodon' && post.platform !== 'threads') return [];
    return embeds.getMastodonMedia(post.embeds, post.raw);
  }

  function getBskyImages(): any[] {
    if (post.platform !== 'bluesky') return [];
    return embeds.getBskyImages(post.embeds);
  }

  function getBskyExternal(): any | null {
    if (post.platform !== 'bluesky') return null;
    return embeds.getBskyExternal(post.embeds);
  }

  function getBskyQuote(): any | null {
    if (post.platform !== 'bluesky') return null;
    return embeds.getBskyQuote(post.embeds);
  }

  function getBskyVideo(): any | null {
    if (post.platform !== 'bluesky') return null;
    return embeds.getBskyVideo(post.embeds);
  }

  function getThreadsQuote(): any | null {
    if (post.platform !== 'threads') return null;
    const raw = (post.raw ?? {}) as any;
    return raw.quoted_post ?? null;
  }

  function getMastodonCard(): any | null {
    if (post.platform !== 'mastodon') return null;
    return embeds.getMastodonCard(post.raw);
  }

  const mastodonCard = $derived(getMastodonCard());
  const mastodonMedia = $derived(getMastodonMedia());
  const bskyImages = $derived(getBskyImages());
  const bskyExternal = $derived(getBskyExternal());
  const bskyQuote = $derived(getBskyQuote());
  const quoteImages = $derived(bskyQuote?.embeds?.[0]?.$type === 'app.bsky.embed.images#view' ? bskyQuote.embeds[0].images ?? [] : []);
  const splitQuote = $derived(!hideMedia && quoteImages.length > 0 && bskyImages.length === 0 && !getBskyExternal() && !getBskyVideo());
  const threadsQuote = $derived(getThreadsQuote());
  const bskyVideo = $derived(getBskyVideo());
  const mastodonHtml = $derived.by(() =>
    // Emoji go in through the DOM, after sanitizing. The string replace this
    // replaces interpolated a remote URL into an attribute — after DOMPurify
    // had already run, so nothing was checking it.
    injectCustomEmoji(sanitizeHtml(getMastodonHtml()), post.emojis),
  );
  const bskyHtml = $derived(getBskyHtml());
  const bskyExternalHost = $derived.by(() => {
    if (!bskyExternal) return '';
    try { return new URL(bskyExternal.uri).hostname; } catch { return bskyExternal.uri; }
  });
  // Klipy GIF embeds carry mp4=/webm= tokens that name sibling files in the
  // same directory ({dir}/{token}.mp4) — NOT a /v/{token}.mp4 path
  const gifVideo = $derived.by(() => {
    if (!bskyExternal || !/\.gif(\?|$)/i.test(bskyExternal.uri)) return null;
    try {
      const u = new URL(bskyExternal.uri);
      if (!u.hostname.endsWith('klipy.com')) return null;
      const variant = (token: string | null, ext: string) => {
        if (!token) return null;
        const v = new URL(u.href);
        const parts = v.pathname.split('/');
        parts[parts.length - 1] = `${token}.${ext}`;
        v.pathname = parts.join('/');
        v.search = '';
        return v.href;
      };
      const mp4 = variant(u.searchParams.get('mp4'), 'mp4');
      const webm = variant(u.searchParams.get('webm'), 'webm');
      return mp4 || webm ? { mp4, webm } : null;
    } catch {
      return null;
    }
  });
  let gifVideoFailed = $state(false);

  /** Reserve a bounded preview frame before the image loads. */
  const MEDIA_MIN_RATIO = 0.5;   // 1:2, the tallest we render uncropped
  const MEDIA_MAX_RATIO = 2;     // 2:1, the widest

  function mediaBoxStyle(w?: number, h?: number): string {
    if (!w || !h || w <= 0 || h <= 0) return '';
    const ratio = Math.min(Math.max(w / h, MEDIA_MIN_RATIO), MEDIA_MAX_RATIO);
    return `aspect-ratio: ${ratio.toFixed(4)}; max-height: min(18rem, 32svh);`;
  }
  // Klipy GIF URLs carry their dimensions as ww=/hh= query params
  const gifBoxStyle = $derived.by(() => {
    if (!bskyExternal) return '';
    try {
      const u = new URL(bskyExternal.uri);
      return mediaBoxStyle(Number(u.searchParams.get('ww')), Number(u.searchParams.get('hh')));
    } catch { return ''; }
  });
  const mastodonCardHost = $derived.by(() => {
    if (!mastodonCard) return '';
    try { return new URL(mastodonCard.url).hostname; } catch { return mastodonCard.url; }
  });
  const relAge = $derived(relativeTime(post.createdAt));
  const platformColor = $derived(`var(--color-${post.platform})`);

  // Labels on Bluesky posts
  const postLabels = $derived.by(() => {
    if (post.platform !== 'bluesky') return [];
    const raw = (post.raw ?? {}) as any;
    const labels = raw?.post?.labels ?? raw?.labels ?? [];
    return labels.filter((l: any) => !l.neg).map((l: any) => l.val);
  });

  // Check label preferences (cached to avoid repeated JSON.parse per post)
  let _labelPrefsCache: { prefs: Record<string, string>; ts: number } | null = null;
  function getLabelPrefs(): Record<string, string> {
    const now = Date.now();
    if (_labelPrefsCache && now - _labelPrefsCache.ts < 10000) return _labelPrefsCache.prefs;
    _labelPrefsCache = { prefs: readJson<Record<string, string>>('crispdeck-label-prefs', {}), ts: now };
    return _labelPrefsCache.prefs;
  }

  function shouldWarnLabel(label: string): boolean {
    const prefs = getLabelPrefs();
    return prefs[label] === 'warn' || (!prefs[label] && ['porn', 'sexual', 'graphic-media', 'nudity'].includes(label));
  }

  function shouldHideLabel(label: string): boolean {
    const prefs = getLabelPrefs();
    return prefs[label] === 'hide';
  }

  const hiddenByLabel = $derived(postLabels.some(shouldHideLabel));
  const warnedLabels = $derived(postLabels.filter(shouldWarnLabel));
  let labelRevealed = $state(false);

  // Alt text badge popover — tracks which image index is showing alt text (null = none)
  let altPopoverIndex: number | null = $state(null);

  function toggleAltPopover(index: number, e: MouseEvent) {
    e.stopPropagation();
    altPopoverIndex = altPopoverIndex === index ? null : index;
  }
</script>

{#if hiddenByLabel && !labelRevealed}
  <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] text-center">
    <p class="text-xs text-[var(--color-text-muted)]">Content hidden: {postLabels.join(', ')}</p>
    <button onclick={() => labelRevealed = true} class="text-xs text-[var(--color-primary-text)] hover:underline mt-1">{i18n.t.post.showAnyway}</button>
  </div>
{:else}
<!-- <article>, not <div>: a screen reader can then move post to post. Without
     it a timeline is one undifferentiated run of text hundreds of items long. -->
<article bind:this={postEl} data-post-uri={post.uri} class="group {compact ? 'p-2.5' : 'p-4'} bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] transition-shadow">
  <!-- Label warnings -->
  {#if warnedLabels.length > 0 && !labelRevealed}
    <div class="mb-2 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-xs text-yellow-300 flex items-center justify-between">
      <span>Content warning: {warnedLabels.join(', ')}</span>
      <button onclick={() => labelRevealed = true} class="text-yellow-400 hover:underline ml-2">{i18n.t.moderation.show}</button>
    </div>
  {/if}

  <!-- Label badges -->
  {#if postLabels.length > 0}
    <div class="mb-2 flex items-center gap-1 flex-wrap">
      {#each postLabels as label}
        <span class="text-[9px] px-1.5 py-0.5 bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] rounded">{label}</span>
      {/each}
    </div>
  {/if}

  <div class="preview-wrap">
  <div class:feed-preview={feedPreview && !previewExpanded} bind:this={previewElement}>
  <div class="post-layout-container" bind:this={previewContent}>
  <div class="post-layout {(!hideMedia && (splitQuote || (!bskyQuote && !threadsQuote && (bskyExternal || mastodonCard || (bskyImages.length === 1 && !bskyVideo) || (mastodonMedia.length === 1 && !bskyVideo) || (bskyVideo && bskyImages.length === 0 && mastodonMedia.length === 0))))) ? 'can-side' : ''}">
  <div class="post-copy">
  {#if feedPreview && replyContext(post)}
    {@const context = replyContext(post)!}
    <a class="reply-context" href={post.platform === 'mastodon' ? `${base}/thread?id=${encodeURIComponent(context.uri)}&platform=mastodon` : `${base}/thread?uri=${encodeURIComponent(context.uri)}&platform=${post.platform}`}>
      <span class="reply-context-label">↪ {context.author ? i18n.t.post.replyingTo.replace('{name}', context.author) : i18n.t.post.replyingToPost}</span>
      {#if context.text}<span class="reply-context-text">{context.text}</span>{/if}
    </a>
  {/if}
  <div class="flex items-start {compact ? 'gap-2' : 'gap-3'}">
    <div class="relative group/avatar">
      <a href={getProfileUrl(post)}>
        {#if post.author.avatar}
          <img loading="lazy" decoding="async" src={post.author.avatar} alt="" width="40" height="40" class="{compact ? 'w-7 h-7' : 'w-10 h-10'} rounded-full bg-[var(--color-surface-hover)]" />
        {:else}
          <div class="{compact ? 'w-7 h-7 text-[9px]' : 'w-10 h-10 text-xs'} rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center text-[var(--color-text-muted)]">
            {post.author.handle.charAt(0).toUpperCase()}
          </div>
        {/if}
      </a>
      <button
        onclick={(e) => { e.stopPropagation(); following = !following; onfollow?.(post, following); }}
        class="absolute -bottom-1 -right-1 {compact ? 'w-4 h-4' : 'w-5 h-5'} rounded-full flex items-center justify-center transition-all opacity-0 group-hover/avatar:opacity-100 {following ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-primary)] text-white'}"
        title={following ? 'Following' : 'Follow'}
        aria-label={following ? `Unfollow ${post.author.handle}` : `Follow ${post.author.handle}`}
      >
        {#if following}<UserCheck size={10} />{:else}<UserPlus size={10} />{/if}
      </button>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-1">
        <a href={getProfileUrl(post)} class="flex items-center gap-2 min-w-0 group">
          <span class="font-semibold text-[var(--color-text)] group-hover:underline truncate text-sm">
            {post.author.displayName || post.author.handle}
          </span>
          <span class="text-[var(--color-text-muted)] text-xs truncate">{post.author.handle}</span>
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background: {platformColor}"></span>
        </a>
        {#if post.isRepost && post.repostAuthor}
          <span class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] min-w-0 truncate" title="Reposted by {post.repostAuthor.displayName || post.repostAuthor.handle}">
            <Repeat size={12} /> <span class="truncate">Reposted by {post.repostAuthor.displayName || post.repostAuthor.handle}</span>
          </span>
        {/if}
        <a href={getThreadUrl(post)} class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline flex-shrink-0 ml-auto" title={formatDate(post.createdAt)}>
          <!-- <time datetime> carries the real instant. "2h" read aloud on its
               own says nothing, and the title attribute is mouse-only. -->
          <time datetime={post.createdAt}>{relAge}</time>
        </a>
        {#if post.platform === 'mastodon' && (post.raw as any)?.edited_at}
          <span class="text-[9px] text-[var(--color-text-muted)] opacity-60" title="Edited {formatDate((post.raw as any).edited_at)}">(edited)</span>
        {/if}
      </div>
      <a href={getThreadUrl(post)} class="block min-w-0 hover:bg-[var(--color-surface-hover)]/30 rounded -mx-1 px-1 transition-colors">
        {#if post.platform === 'mastodon' && mastodonHtml}
        <!-- Delegation surface for the links inside {@html}: the interactive
             elements are the real <a> tags this contains, which are already
             focusable and Enter-activatable, and the click they emit bubbles
             here. The onkeydown that used to sit alongside was a duplicate of
             that same bubbled click. (svelte-ignore must be the comment
             immediately before the element, so it goes last.) -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="text-sm text-[var(--color-text)] break-words whitespace-pre-wrap prose-invert [&_a]:text-blue-400 [&_a]:hover:underline" onclick={handlePostLinkClick}>
            {@html mastodonHtml}
          </div>
        {:else if post.platform === 'bluesky' && bskyHtml}
        <!-- Delegation surface for the links inside {@html}: the interactive
             elements are the real <a> tags this contains, which are already
             focusable and Enter-activatable, and the click they emit bubbles
             here. The onkeydown that used to sit alongside was a duplicate of
             that same bubbled click. (svelte-ignore must be the comment
             immediately before the element, so it goes last.) -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="text-sm text-[var(--color-text)] break-words whitespace-pre-wrap [&_a]:text-blue-400 [&_a]:hover:underline" onclick={handlePostLinkClick}>
            {@html bskyHtml}
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
  {#if splitQuote}
    <button type="button" class="quote-copy mt-2 ml-13 text-left border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)] hover:border-[var(--color-text-muted)]" onclick={() => goto(`${base}/thread?uri=${encodeURIComponent(bskyQuote.uri)}&platform=bluesky`)}>
      <span class="flex items-center gap-2 mb-1">
        {#if bskyQuote.author?.avatar}<img decoding="async" loading="lazy" src={bskyQuote.author.avatar} alt="" class="w-5 h-5 rounded-full" />{/if}
        <span class="text-xs font-medium">{bskyQuote.author?.displayName || bskyQuote.author?.handle}</span>
        <span class="text-[10px] text-[var(--color-text-muted)]">@{bskyQuote.author?.handle}</span>
      </span>
      <span class="block text-sm text-[var(--color-text)] line-clamp-6">{(bskyQuote.value as any)?.text ?? ''}</span>
    </button>
  {/if}
  </div>

  {#if !hideMedia}
    <div class="post-media mt-2 pl-13">
      {#if splitQuote}
        <button type="button" class="media-preview-button w-full" onclick={() => openLightbox(quoteImages.map((img: any) => ({ url: img.fullsize, thumb: img.thumb, alt: img.alt })), 0)} aria-label={i18n.t.post.viewQuotedImages}>
          <img decoding="async" loading="lazy" src={quoteImages[0].thumb} alt={quoteImages[0].alt || ''} class="media-preview-image" />
        </button>
        {#if quoteImages.length > 1}<p class="mt-1 text-[10px] text-[var(--color-text-muted)]">+{quoteImages.length - 1} more</p>{/if}
      {/if}
      <!-- Bluesky images -->
      {#if bskyImages.length > 0}
        <div class="relative pt-2">
        <div class={bskyImages.length > 1 ? 'media-strip' : ''}>
          {#each bskyImages as image, i}
            {@const boxStyle = bskyImages.length === 1 ? mediaBoxStyle(image.aspectRatio?.width, image.aspectRatio?.height) : ''}
            <!-- The ALT badge is a sibling of the image button, not a child
                 of it: nesting one control inside another is invalid HTML,
                 and the tabindex="-1" it needed to survive there left the
                 alt text reachable by mouse only. -->
            <div class="relative {bskyImages.length > 1 ? 'media-tile' : ''}">
              <button
                type="button"
                onclick={() => openLightbox(bskyImages.map(img => ({ url: img.fullsize, thumb: img.thumb, alt: img.alt })), i)}
                style={boxStyle}
                class="media-preview-button cursor-pointer w-full {bskyImages.length > 1 ? 'h-full' : ''}"
              >
                <img decoding="async" loading="lazy" src={image.thumb} alt={image.alt || ''} class="media-preview-image" />
              </button>
              {#if hasAltText(image.alt)}
                <button
                  type="button"
                  class="absolute bottom-1 left-1 px-1 py-0.5 text-[9px] font-bold bg-black/70 text-white rounded"
                  onclick={(e) => toggleAltPopover(i, e)}
                  aria-expanded={altPopoverIndex === i}
                  aria-label={i18n.t.post.showAltText}
                >ALT</button>
                {#if altPopoverIndex === i}
                  <div class="absolute bottom-7 left-0 p-2 bg-black/90 text-white text-xs rounded-lg max-w-[250px] max-h-[80%] overflow-auto z-10">
                    {image.alt}
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
        {#if bskyImages.length > 2}
          <button type="button" class="media-scroll media-scroll-left" aria-label={i18n.t.post.scrollImagesLeft} onclick={(e) => scrollMedia(e, -1)}>‹</button>
          <button type="button" class="media-scroll media-scroll-right" aria-label={i18n.t.post.scrollImagesRight} onclick={(e) => scrollMedia(e, 1)}>›</button>
        {/if}
        </div>
      {/if}

      <!-- Bluesky external link -->
      {#if bskyExternal}
        {@const isGif = /\.gif(\?|$)/i.test(bskyExternal.uri)}
        {#if gifVideo && !gifVideoFailed}
          <!-- Animated GIF with MP4/WebM variants — render as auto-playing muted video.
               If every source fails, fall back to the plain GIF image below. -->
          <div class="mt-2 rounded-lg overflow-hidden border border-[var(--color-border)]">
            <video autoplay loop muted playsinline poster={bskyExternal.thumb} style={gifBoxStyle} class="w-full object-contain {gifBoxStyle ? '' : 'max-h-64'} bg-black/10" onerror={() => gifVideoFailed = true}>
              {#if gifVideo.mp4}<source src={gifVideo.mp4} type="video/mp4" onerror={() => { if (!gifVideo.webm) gifVideoFailed = true; }} />{/if}
              {#if gifVideo.webm}<source src={gifVideo.webm} type="video/webm" onerror={() => gifVideoFailed = true} />{/if}
            </video>
          </div>
        {:else if isGif}
          <!-- Animated GIF — render inline -->
          <div class="mt-2 rounded-lg overflow-hidden border border-[var(--color-border)]">
            <img decoding="async" loading="lazy" src={bskyExternal.uri} alt={bskyExternal.title || 'GIF'} style={gifBoxStyle} class="w-full object-contain {gifBoxStyle ? '' : 'max-h-64'} bg-black/10" />
          </div>
        {:else}
          <!-- Standard link card -->
          <a href={hrefOrHash(bskyExternal.uri)} onclick={(e) => openExternalLink(e, bskyExternal.uri, () => toast.error(i18n.t.post.openLinkFailed))} target="_blank" rel="noopener noreferrer" class="mt-2 block border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
            {#if bskyExternal.thumb}
              <div class="link-preview-media"><img decoding="async" loading="lazy" src={bskyExternal.thumb} alt="" class="link-preview-image" /></div>
            {/if}
            <div class="p-3">
              <p class="text-xs text-[var(--color-text-muted)]">{bskyExternalHost}</p>
              <p class="font-semibold text-sm text-[var(--color-text)]">{bskyExternal.title}</p>
              {#if bskyExternal.description}
                <p class="text-xs text-[var(--color-text-muted)] line-clamp-2">{bskyExternal.description}</p>
              {/if}
            </div>
          </a>
        {/if}
      {/if}

      <!-- Bluesky quoted post -->
      {#if bskyQuote && !splitQuote}
        <button
          type="button"
          onclick={() => goto(`${base}/thread?uri=${encodeURIComponent(bskyQuote.uri)}&platform=bluesky`)}
          class="mt-2 w-full text-left border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)] cursor-pointer hover:border-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <div class="flex items-center gap-2 mb-1">
            {#if bskyQuote.author?.avatar}
              <img decoding="async" loading="lazy" src={bskyQuote.author.avatar} alt="" class="w-5 h-5 rounded-full" />
            {/if}
            <span class="text-xs font-medium">{bskyQuote.author?.displayName || bskyQuote.author?.handle}</span>
            <span class="text-[10px] text-[var(--color-text-muted)]">@{bskyQuote.author?.handle}</span>
          </div>
          <p class="text-sm text-[var(--color-text)] line-clamp-6">{(bskyQuote.value as any)?.text ?? ''}</p>
          {#if bskyQuote.embeds?.[0]}
            {@const qEmbed = bskyQuote.embeds[0]}
            {#if qEmbed.$type === 'app.bsky.embed.images#view' && qEmbed.images?.[0]}
              <div onclick={(e: MouseEvent) => { e.stopPropagation(); openLightbox(qEmbed.images.map((img: any) => ({ url: img.fullsize, thumb: img.thumb, alt: img.alt })), 0); }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openLightbox(qEmbed.images.map((img: any) => ({ url: img.fullsize, thumb: img.thumb, alt: img.alt })), 0); } }} class="cursor-pointer" role="button" tabindex="0" aria-label={i18n.t.post.viewQuotedImages}>
                <div class="link-preview-media mt-2 rounded"><img decoding="async" loading="lazy" src={qEmbed.images[0].thumb} alt={qEmbed.images[0].alt || ''} class="link-preview-image" /></div>
                {#if qEmbed.images.length > 1}
                  <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">+{qEmbed.images.length - 1} more</p>
                {/if}
              </div>
            {/if}
            {#if qEmbed.$type === 'app.bsky.embed.external#view' && qEmbed.external}
              <div class="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                {#if qEmbed.external.thumb}
                  <img decoding="async" loading="lazy" src={qEmbed.external.thumb} alt="" class="w-12 h-12 rounded object-contain" />
                {/if}
                <div class="min-w-0">
                  <p class="font-medium truncate">{qEmbed.external.title}</p>
                  <p class="truncate">{new URL(qEmbed.external.uri).hostname}</p>
                </div>
              </div>
            {/if}
          {/if}
        </button>
      {/if}

      <!-- Threads quoted post -->
      {#if threadsQuote}
        <button
          type="button"
          onclick={() => {
            const permalink = threadsQuote.permalink;
            if (permalink) window.open(permalink, '_blank', 'noopener,noreferrer');
          }}
          class="mt-2 w-full text-left border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-bg)] cursor-pointer hover:border-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-medium">@{threadsQuote.username}</span>
          </div>
          {#if threadsQuote.text}
            <p class="text-sm text-[var(--color-text)] line-clamp-6">{threadsQuote.text}</p>
          {/if}
          {#if threadsQuote.media_url && threadsQuote.media_type !== 'TEXT_POST'}
            <img decoding="async" loading="lazy" src={threadsQuote.thumbnail_url ?? threadsQuote.media_url} alt="" class="mt-2 rounded w-full max-h-48 object-contain" />
          {/if}
        </button>
      {/if}

      <!-- Bluesky video -->
      {#if bskyVideo}
        <BlueskyVideo playlist={bskyVideo.playlist} thumbnail={bskyVideo.thumbnail} alt={bskyVideo.alt} postUrl={getPostUrl(post)} />
      {/if}

      <!-- Mastodon images -->
      {#if mastodonMedia.length > 0}
        <div class="relative pt-2">
        <div class={mastodonMedia.length > 1 ? 'media-strip' : ''}>
          {#each mastodonMedia as attachment, i}
            {@const imageUrl = attachment.previewUrl || attachment.url || attachment.remoteUrl}
            {@const mastoAltIndex = bskyImages.length + i}
            {#if imageUrl}
              {@const mastoBoxStyle = mastodonMedia.length === 1 ? mediaBoxStyle(attachment.meta?.original?.width, attachment.meta?.original?.height) : ''}
              <!-- ALT badge as a sibling button, not nested in the image
                   button: see the Bluesky block above. -->
              <div class="relative {mastodonMedia.length > 1 ? 'media-tile' : ''}">
                <button
                  type="button"
                  onclick={() => openLightbox(mastodonMedia.map(a => ({ url: a.url || a.previewUrl || a.remoteUrl || '', thumb: a.previewUrl || a.url || '', alt: a.description })), i)}
                  style={mastoBoxStyle}
                  class="media-preview-button cursor-pointer w-full {mastodonMedia.length > 1 ? 'h-full' : ''}"
                >
                  <img decoding="async" loading="lazy" src={imageUrl} alt={attachment.description || `Image ${i + 1}`} class="media-preview-image" />
                </button>
                {#if hasAltText(attachment.description)}
                  <button
                    type="button"
                    class="absolute bottom-1 left-1 px-1 py-0.5 text-[9px] font-bold bg-black/70 text-white rounded"
                    onclick={(e) => toggleAltPopover(mastoAltIndex, e)}
                    aria-expanded={altPopoverIndex === mastoAltIndex}
                    aria-label={i18n.t.post.showAltText}
                  >ALT</button>
                  {#if altPopoverIndex === mastoAltIndex}
                      <div class="absolute bottom-7 left-0 p-2 bg-black/90 text-white text-xs rounded-lg max-w-[250px] max-h-[80%] overflow-auto z-10">
                      {attachment.description}
                    </div>
                  {/if}
                {/if}
              </div>
            {/if}
          {/each}
        </div>
        {#if mastodonMedia.length > 2}
          <button type="button" class="media-scroll media-scroll-left" aria-label={i18n.t.post.scrollImagesLeft} onclick={(e) => scrollMedia(e, -1)}>‹</button>
          <button type="button" class="media-scroll media-scroll-right" aria-label={i18n.t.post.scrollImagesRight} onclick={(e) => scrollMedia(e, 1)}>›</button>
        {/if}
        </div>
      {/if}

      <!-- Mastodon link card -->
      {#if mastodonCard}
        <a href={hrefOrHash(mastodonCard.url)} onclick={(e) => openExternalLink(e, mastodonCard.url, () => toast.error(i18n.t.post.openLinkFailed))} target="_blank" rel="noopener noreferrer" class="mt-2 block border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
          {#if mastodonCard.image}
            <div class="link-preview-media"><img decoding="async" loading="lazy" src={mastodonCard.image} alt="" class="link-preview-image" /></div>
          {/if}
          <div class="p-3">
            <p class="text-xs text-[var(--color-text-muted)]">{mastodonCard.provider_name || mastodonCardHost}</p>
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
  </div>
  </div>
  </div>
  </div>

  <div class="flex items-center justify-between mt-3 pl-13">
    <div class="flex items-center gap-4 flex-wrap">
      {#if feedPreview && (previewClipped || previewExpanded)}
        <button type="button" class="preview-toggle" onclick={() => { previewExpanded = !previewExpanded; }}>{previewExpanded ? i18n.t.post.showLessPost : i18n.t.post.showFullPost}</button>
      {/if}
      {#if onreply}
        <button onclick={() => onreply?.(post)} class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-blue-400 transition-all hover:scale-110 active:scale-90" title={i18n.t.post.reply} aria-label="Reply ({post.replyCount ?? 0} replies)">
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
        class="flex items-center gap-1.5 transition-all {boosted ? 'text-green-400' : 'text-[var(--color-text-muted)]'} {onboost ? 'hover:text-green-400 hover:scale-110 active:scale-90' : ''}"
        title={i18n.t.post.boost}
        aria-label="{boosted ? 'Undo boost' : 'Boost'} ({localBoostCount} boosts)"
        aria-pressed={boosted}
      >
        <Repeat size={14} />
        {#if !hideEngagement}<span class="text-xs">{localBoostCount}</span>{/if}
      </button>

      {#if onquote}
        <button
          onclick={() => onquote?.(post)}
          class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-purple-400 transition-all hover:scale-110 active:scale-90"
          title={i18n.t.post.quote}
          aria-label={i18n.t.post.quotePost}
        >
          <Quote size={14} />
        </button>
      {/if}

      <button
        onclick={handleLike}
        disabled={!onlike}
        class="flex items-center gap-1.5 transition-all relative {liked ? 'text-red-400' : 'text-[var(--color-text-muted)]'} {onlike ? 'hover:text-red-400 hover:scale-110 active:scale-90' : ''}"
        title={i18n.t.post.like}
        aria-label="{liked ? 'Unlike' : 'Like'} ({localLikeCount} likes)"
        aria-pressed={liked}
      >
        <Heart size={14} class="{liked ? 'fill-current' : ''} {likeAnimating ? 'like-pop' : ''}" />
        {#if likeAnimating}
          <span class="like-burst" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span>
          </span>
        {/if}
        {#if !hideEngagement}<span class="text-xs">{localLikeCount}</span>{/if}
      </button>

      <button
        onclick={handleBookmark}
        class="flex items-center gap-1.5 transition-all {bookmarked ? 'text-yellow-400' : 'text-[var(--color-text-muted)]'} hover:text-yellow-400 hover:scale-110 active:scale-90"
        title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this post'}
        aria-pressed={bookmarked}
      >
        <Bookmark size={14} class={bookmarked ? 'fill-current' : ''} />
      </button>

      <button
        onclick={handlePin}
        class="flex items-center gap-1.5 transition-colors {pinned ? 'text-orange-400' : 'text-[var(--color-text-muted)]'} hover:text-orange-400 opacity-0 group-hover:opacity-100"
        title={pinned ? 'Unpin' : 'Pin to top'}
        aria-label={pinned ? 'Unpin post' : 'Pin post to top'}
        aria-pressed={pinned}
      >
        <Pin size={12} class={pinned ? 'fill-current' : ''} />
      </button>

      <!-- Add to reading list -->
      <div class="relative">
        <button
          onclick={openListPicker}
          class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors opacity-0 group-hover:opacity-100"
          title={i18n.t.post.addToReadingList}
          aria-label={i18n.t.post.addPostToReadingList}
        >
          <ListPlus size={12} />
        </button>
        {#if showListPicker}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="fixed inset-0 z-40" onclick={() => showListPicker = false} onkeydown={(e) => { if (e.key === 'Escape') showListPicker = false; }}></div>
          <div class="absolute bottom-full right-0 mb-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 py-1 min-w-[160px] max-h-40 overflow-y-auto">
            {#if readingLists.length > 0}
              {#each readingLists as rl}
                <button
                  onclick={() => addToList(rl.id)}
                  class="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-surface-hover)] truncate"
                >
                  {rl.name}
                </button>
              {/each}
            {:else}
              <p class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">{i18n.t.post.noReadingLists}</p>
            {/if}
            <a
              href="{base}/bookmarks?tab=reading-lists"
              onclick={() => showListPicker = false}
              class="block px-3 py-1.5 text-xs text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] border-t border-[var(--color-border)]"
            >
              Manage lists
            </a>
          </div>
        {/if}
      </div>

      <button
        onclick={handleShare}
        class="flex items-center gap-1.5 transition-colors {copied ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'} hover:text-[var(--color-text)]"
        title={copied ? 'Copied!' : 'Copy link'}
        aria-label={i18n.t.post.copyLinkToPost}
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
        title={i18n.t.post.shareAsImage}
        aria-label={i18n.t.post.sharePostAsImage}
      >
        {#if capturingImage}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <Camera size={12} />
        {/if}
      </button>
      {#if shareError}
        <span class="text-[9px] text-red-400">{shareError}</span>
      {/if}

      <button
        onclick={() => showStats = !showStats}
        class="flex items-center gap-1.5 transition-colors {showStats ? 'text-[var(--color-primary-text)]' : 'text-[var(--color-text-muted)]'} hover:text-[var(--color-primary-text)] opacity-0 group-hover:opacity-100"
        title={i18n.t.post.postStatistics}
        aria-label={i18n.t.post.showPostStatistics}
        aria-pressed={showStats}
      >
        <BarChart3 size={12} />
      </button>

      <button
        onclick={handleReport}
        class="flex items-center gap-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors opacity-0 group-hover:opacity-100"
        title={i18n.t.post.report}
        aria-label={i18n.t.post.reportPost}
      >
        <Flag size={12} />
      </button>
    </div>
    <a href={getPostUrl(post)} target="_blank" rel="noopener noreferrer" class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline opacity-0 group-hover:opacity-100">
      {post.platform}
    </a>
  </div>

  <!-- Post statistics overlay -->
  {#if showStats}
    {@const totalEngagement = (post.likeCount ?? 0) + (post.repostCount ?? 0) + (post.replyCount ?? 0)}
    {@const engagementRate = totalEngagement > 0 ? 100 : 0}
    <div class="mt-3 pl-13 p-3 bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] space-y-2">
      <div class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <BarChart3 size={12} />
        <span class="font-medium">{i18n.t.post.engagementBreakdown}</span>
        <span class="ml-auto text-[10px]">{post.platform}</span>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-red-400">{post.likeCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.post.likes}</div>
        </div>
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-green-400">{post.repostCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.post.reposts}</div>
        </div>
        <div class="text-center p-2 bg-[var(--color-surface)] rounded">
          <div class="text-lg font-bold text-blue-400">{post.replyCount ?? 0}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.post.replies}</div>
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
</article>

{#if lightboxIndex !== null}
  <MediaLightbox items={lightboxItems} index={lightboxIndex} onclose={closeLightbox} />
{/if}
{/if}

<style>
  .reply-context { display: block; margin: 0 0 0.45rem 3.25rem; padding: 0.25rem 0.55rem; border-left: 2px solid var(--color-border); color: var(--color-text-muted); }
  .reply-context:hover { color: var(--color-text); }
  .reply-context-label { display: block; font-size: 0.7rem; }
  .reply-context-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .preview-wrap { position: relative; }
  .feed-preview { max-height: calc(50svh - 9rem); overflow: clip; }
  .preview-toggle { color: var(--color-primary-text); font-size: 0.75rem; }
  .post-layout-container { container-type: inline-size; }
  .feed-preview .media-preview-image, .feed-preview .link-preview-image { max-height: min(18rem, 22svh); }
  .feed-preview .media-tile { height: min(22svh, 13rem); }
  @container (min-width: 42rem) {
    :global(html[data-side-media='true']) .post-layout.can-side {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(14rem, 40%);
      gap: 1rem;
      align-items: start;
    }
    :global(html[data-side-media='true']) .post-layout.can-side .post-media {
      padding-inline-start: 0;
      margin-top: 0;
      min-width: 0;
    }
  }
  .link-preview-media {
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--color-surface-hover);
  }
  .link-preview-image {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: min(18rem, 32svh);
    object-fit: contain;
  }
  .media-preview-button {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 0.375rem;
    background: var(--color-surface-hover);
  }
  .media-preview-image {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: min(18rem, 32svh);
    object-fit: contain;
  }
  .media-tile .media-preview-image { max-height: 100%; }
  .media-strip {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
  }
  .media-tile {
    flex: 0 0 calc((100% - 0.5rem) / 2);
    height: min(30svh, 15rem);
    min-width: 0;
    scroll-snap-align: start;
  }
  .media-scroll {
    position: absolute;
    top: 50%;
    z-index: 10;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    background: rgb(0 0 0 / 0.7);
    color: white;
    font-size: 1.5rem;
    line-height: 1;
  }
  .media-scroll-left { left: 0.25rem; }
  .media-scroll-right { right: 0.25rem; }
</style>
