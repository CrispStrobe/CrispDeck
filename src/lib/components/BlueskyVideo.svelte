<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hrefOrHash, safeExternalUrl } from '$lib/safe-url';
  import { i18n } from '$lib/i18n.svelte';
  import type Hls from 'hls.js';

  let { playlist, thumbnail, alt = '', postUrl }: { playlist: string; thumbnail?: string; alt?: string; postUrl: string } = $props();
  let video: HTMLVideoElement | undefined = $state();
  let active = $state(false);
  let failed = $state(false);
  let hls: Hls | undefined;
  let destroyed = false;

  async function play() {
    const url = safeExternalUrl(playlist);
    if (!url) { failed = true; return; }
    active = true;
    const player = video;
    if (!player || destroyed) return;
    if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = url;
    } else {
      try {
        const { default: HlsPlayer } = await import('hls.js');
        if (destroyed) return;
        if (!HlsPlayer.isSupported()) { failed = true; return; }
        hls = new HlsPlayer();
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) failed = true; });
        hls.loadSource(url);
        hls.attachMedia(player);
      } catch {
        failed = true;
        return;
      }
    }
    // Browsers may require a second tap after an asynchronous player load;
    // native controls remain available if autoplay is refused.
    void player.play().catch(() => {});
  }

  onDestroy(() => { destroyed = true; hls?.destroy(); });
</script>

<div class="video-card mt-2 rounded-lg overflow-hidden border border-[var(--color-border)]">
  {#if failed}
    <p class="p-3 text-sm text-[var(--color-text-muted)]">{i18n.t.post.videoPlaybackFailed} <a class="underline" href={hrefOrHash(postUrl)} target="_blank" rel="noopener noreferrer">{i18n.t.post.openVideoPost}</a></p>
  {:else}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} class:video-inactive={!active} controls playsinline preload="none" poster={thumbnail} aria-label={alt || i18n.t.post.playVideo} onerror={() => { if (active) failed = true; }}></video>
    {#if !active}
    <button type="button" class="video-preview" onclick={play} aria-label={alt ? `${i18n.t.post.playVideo}: ${alt}` : i18n.t.post.playVideo}>
      {#if thumbnail}<img src={thumbnail} alt="" loading="lazy" decoding="async" />{/if}
      <span class="play-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
    </button>
    {/if}
  {/if}
  {#if alt}<p class="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]">{alt}</p>{/if}
</div>

<style>
  .video-card { background: var(--color-surface-hover); }
  .video-preview { position: relative; display: flex; justify-content: center; align-items: center; width: 100%; min-height: 5rem; }
  .video-preview img, video { display: block; width: auto; height: auto; max-width: 100%; max-height: min(18rem, 32svh); margin-inline: auto; object-fit: contain; }
  video.video-inactive { display: none; }
  .play-icon { position: absolute; display: flex; align-items: center; justify-content: center; width: 3rem; height: 3rem; border-radius: 50%; color: white; background: rgb(0 0 0 / 0.7); }
</style>
