<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { base } from '$app/paths';
  import { i18n } from '$lib/i18n.svelte';
  import { toast } from '$lib/toast.svelte';
  import { saveToWallabag } from '$lib/wallabag';
  let menu = $state<{ url: string; x: number; y: number } | null>(null);
  let menuElement: HTMLDivElement | undefined = $state();
  let wallabag = $state('');
  let canShare = $state(false);
  onMount(() => {
    if (!isTauri()) return;
    canShare = typeof navigator.share === 'function';
    async function show(event: MouseEvent) {
      if (event.shiftKey || event.defaultPrevented) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      let url: URL;
      try { url = new URL(anchor.href); } catch { return; }
      if (!['http:', 'https:'].includes(url.protocol)) return;
      // Internal app routes retain their normal native menu.
      if (url.origin === location.origin) return;
      event.preventDefault();
      wallabag = localStorage.getItem('crispdeck-wallabag-url') ?? '';
      menu = { url: url.href, x: event.clientX, y: event.clientY };
      await tick();
      if (!menuElement || !menu) return;
      const rect = menuElement.getBoundingClientRect();
      menu.x = Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4));
      menu.y = Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4));
      menuElement.querySelector<HTMLButtonElement>('button')?.focus();
    }
    function close(event: Event) { if (menuElement && !menuElement.contains(event.target as Node)) menu = null; }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { menu = null; } }
    document.addEventListener('contextmenu', show);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('contextmenu', show); document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true); };
  });
  async function open(url: string) {
    menu = null;
    try { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(url); }
    catch { toast.error(i18n.t.post.openLinkFailed); }
  }
  async function copy() {
    if (!menu) return;
    const url = menu.url; menu = null;
    try { await navigator.clipboard.writeText(url); toast.success(i18n.t.linkMenu.copied); }
    catch { toast.error(i18n.t.linkMenu.copyFailed); }
  }
  async function share() {
    if (!menu) return;
    const url = menu.url; menu = null;
    try { await navigator.share({url}); } catch { /* User may dismiss the share sheet. */ }
  }
  async function save() {
    if (!menu) return;
    const url = menu.url;
    menu = null;
    if (!wallabag) { location.href = `${base}/settings?tab=appearance#wallabag-url`; return; }
    try { await saveToWallabag(wallabag, url); toast.success(i18n.t.linkMenu.wallabagSaved); }
    catch (e) { toast.error(e instanceof Error ? e.message : i18n.t.linkMenu.wallabagFailed); }
  }
</script>
{#if menu}
  <div bind:this={menuElement} role="menu" aria-label={i18n.t.linkMenu.title} class="link-menu" style:left="{menu.x}px" style:top="{menu.y}px">
    <button role="menuitem" onclick={() => menu && open(menu.url)}>{i18n.t.linkMenu.open}</button>
    <button role="menuitem" onclick={copy}>{i18n.t.linkMenu.copy}</button>
    {#if canShare}<button role="menuitem" onclick={share}>{i18n.t.linkMenu.share}</button>{/if}
    <button role="menuitem" onclick={save}>{wallabag ? i18n.t.linkMenu.saveWallabag : i18n.t.linkMenu.setupWallabag}</button>
    <span class="hint">{i18n.t.linkMenu.systemMenuHint}</span>
  </div>
{/if}
<style>
  .link-menu { position: fixed; z-index: 10000; min-width: 13rem; padding: .3rem; border: 1px solid var(--color-border); border-radius: .55rem; background: var(--color-surface); box-shadow: 0 .5rem 2rem #0008; }
  .link-menu button { display: block; width: 100%; padding: .45rem .6rem; border-radius: .3rem; text-align: left; font-size: .8rem; color: var(--color-text); }
  .link-menu button:hover, .link-menu button:focus-visible { background: var(--color-primary); color: white; outline: none; }
  .hint { display: block; padding: .4rem .6rem .2rem; color: var(--color-text-muted); font-size: .65rem; }
</style>
