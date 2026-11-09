<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { Camera, ExternalLink, Globe, Home, Loader2, RefreshCw, SquareArrowOutUpRight } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { openExternalLink } from '$lib/external-link';
  import {
    INSTAGRAM_HOME_URL,
    createInstagramTimeline,
    instagramCapabilities,
    popoutInstagram,
  } from '$lib/instagram';

  let supported = $state<boolean | null>(null);
  let canPopout = $state(false);
  let ready = $state(false);
  let hidden = $state(false);
  let error = $state('');
  let origin = $state(new URL(INSTAGRAM_HOME_URL).origin);
  let busy = $state<'home' | 'reload' | 'popout' | 'retry' | null>(null);
  let viewport = $state<HTMLDivElement>();
  let controller: ReturnType<typeof createInstagramTimeline> | undefined;
  let mounted = false;
  let generation = 0;

  async function connect() {
    const attempt = ++generation;
    const current = () => mounted && attempt === generation;
    ready = false;
    hidden = false;
    error = '';
    origin = new URL(INSTAGRAM_HOME_URL).origin;
    try {
      await controller?.destroy();
      controller = undefined;
      const available = await instagramCapabilities();
      if (!current()) return;
      supported = available.inline;
      canPopout = available.popout;
      if (!available.inline) return;
      await tick();
      if (!current() || !viewport) return;
      controller = createInstagramTimeline(viewport, {
        onReady() {
          if (!current()) return;
          ready = true;
          error = '';
        },
        onError() {
          if (!current()) return;
          ready = false;
          // Native error strings can contain navigation details. The UI only
          // needs a recovery action, never an Instagram login or callback URL.
          error = i18n.t.instagram.loadFailed;
        },
        onVisibilityChange(visible) {
          if (current()) hidden = !visible;
        },
        onOriginChange(value) {
          if (current()) origin = value;
        },
      });
    } catch {
      if (!current()) return;
      error = i18n.t.instagram.loadFailed;
      if (supported === null) supported = false;
    }
  }

  beforeNavigate(({ from, to }) => {
    if (from?.url.pathname === to?.url.pathname) return;
    // Hide before SvelteKit's page transition paints the destination. Waiting
    // only for unmount would leave a native child above the next page briefly.
    generation++;
    void controller?.destroy().catch(() => {});
  });

  onMount(() => {
    mounted = true;
    void connect();
    return () => {
      mounted = false;
      generation++;
      // The controller also cancels any native creation still in flight.
      void controller?.destroy().catch(() => {});
    };
  });

  async function act(action: 'home' | 'reload' | 'popout' | 'retry') {
    if (busy) return;
    busy = action;
    error = '';
    try {
      if (action === 'retry') await connect();
      else if (action === 'popout') await popoutInstagram();
      else await controller?.[action]();
    } catch {
      if (mounted) error = action === 'popout' ? i18n.t.instagram.popoutFailed : i18n.t.instagram.loadFailed;
    } finally {
      if (mounted) busy = null;
    }
  }

  function external(event: MouseEvent) {
    openExternalLink(event, INSTAGRAM_HOME_URL, () => { error = i18n.t.instagram.browserFailed; });
  }
</script>

<section class="flex h-full min-h-0 flex-col" aria-labelledby="instagram-title">
  <header class="flex-shrink-0 space-y-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 id="instagram-title" class="flex items-center gap-2 text-lg font-bold"><Camera size={20} />{i18n.t.instagram.title}</h1>
        <p class="mt-1 text-xs text-[var(--color-text-muted)]">{i18n.t.instagram.subtitle}</p>
        {#if supported}<p class="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]" aria-label={i18n.t.instagram.originLabel}><Globe size={12} /><span>{origin}</span></p>{/if}
      </div>
      {#if supported}
        <div class="flex flex-wrap items-center gap-2">
          <button class="action" onclick={() => act('home')} disabled={busy !== null || !ready}><Home size={14} />{i18n.t.instagram.home}</button>
          <button class="action" onclick={() => act('reload')} disabled={busy !== null || !ready}><RefreshCw size={14} class={busy === 'reload' ? 'animate-spin' : ''} />{i18n.t.instagram.reload}</button>
          {#if canPopout}<button class="action" onclick={() => act('popout')} disabled={busy !== null}><SquareArrowOutUpRight size={14} />{i18n.t.instagram.popout}</button>{/if}
          <a class="action" href={INSTAGRAM_HOME_URL} target="_blank" rel="noopener noreferrer" onclick={external}><ExternalLink size={14} />{i18n.t.instagram.openBrowser}</a>
        </div>
      {/if}
    </div>
    <p class="text-xs leading-relaxed text-[var(--color-text-muted)]">{i18n.t.instagram.sessionNote} {i18n.t.instagram.followingHint}</p>
  </header>

  {#if error}
    <div role="alert" data-native-webview-overlay class="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <p>{error}</p>
      <button class="action" onclick={() => act('retry')} disabled={busy !== null}>{i18n.t.instagram.retry}</button>
    </div>
  {/if}

  {#if supported === null}
    <div class="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-[var(--color-text-muted)]" role="status"><Loader2 size={18} class="animate-spin" />{i18n.t.instagram.loading}</div>
  {:else if supported}
    <div bind:this={viewport} class="relative min-h-0 flex-1 bg-[var(--color-bg)]" role="region" aria-label={i18n.t.instagram.timelineLabel} aria-busy={!ready && !error}>
      <div class="flex h-full items-center justify-center gap-2 p-6 text-center text-sm text-[var(--color-text-muted)]" role="status">
        {#if hidden && !error}
          {i18n.t.instagram.hidden}
        {:else if !ready && !error}
          <Loader2 size={18} class="animate-spin" />{i18n.t.instagram.loading}
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="max-w-lg space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <Camera size={36} class="mx-auto text-[var(--color-text-muted)]" />
        {#if canPopout}
          <h2 class="text-lg font-semibold">{i18n.t.instagram.windowTitle}</h2>
          <p class="text-sm leading-relaxed text-[var(--color-text-muted)]">{i18n.t.instagram.windowHint}</p>
          <div class="flex flex-wrap items-center justify-center gap-3">
            <button class="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onclick={() => act('popout')} disabled={busy !== null}><SquareArrowOutUpRight size={16} />{i18n.t.instagram.popout}</button>
            <a class="action" href={INSTAGRAM_HOME_URL} target="_blank" rel="noopener noreferrer" onclick={external}><ExternalLink size={14} />{i18n.t.instagram.openBrowser}</a>
          </div>
        {:else}
          <h2 class="text-lg font-semibold">{i18n.t.instagram.externalTitle}</h2>
          <p class="text-sm leading-relaxed text-[var(--color-text-muted)]">{i18n.t.instagram.externalHint}</p>
          <a class="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white" href={INSTAGRAM_HOME_URL} target="_blank" rel="noopener noreferrer" onclick={external}><ExternalLink size={16} />{i18n.t.instagram.openBrowser}</a>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    border: 1px solid var(--color-border);
    border-radius: 0.375rem;
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }
  .action:hover { background: var(--color-surface-hover); }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
