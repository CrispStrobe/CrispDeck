<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Home, Rss, Columns3, PenSquare, FileText, Bell, MessageSquare, Bookmark, Users, Search, List, Package, Shield, Tag, Server, TrendingUp, Archive, BarChart3, Settings, Info, ChevronsLeft, ChevronsRight, Menu, X } from '@lucide/svelte';
  import KeyboardShortcuts from '$lib/components/KeyboardShortcuts.svelte';
  import { i18n } from '$lib/i18n.svelte';

  let { children } = $props();

  import { onMount } from 'svelte';
  import { getBookmarkCount } from '$lib/bookmarks';

  let collapsed = $state(false);
  let mobileMenuOpen = $state(false);
  let showShortcuts = $state(false);
  let pendingG = $state(false);
  let bookmarkCount = $state(0);

  onMount(async () => {
    bookmarkCount = await getBookmarkCount();
    // Refresh count periodically
    const interval = setInterval(async () => {
      bookmarkCount = await getBookmarkCount();
    }, 30000);
    return () => clearInterval(interval);
  });

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Don't capture when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '?') { showShortcuts = !showShortcuts; return; }
    if (e.key === 'Escape') { showShortcuts = false; mobileMenuOpen = false; return; }

    // g+key navigation
    if (e.key === 'g') { pendingG = true; setTimeout(() => pendingG = false, 1000); return; }
    if (pendingG) {
      pendingG = false;
      const routes: Record<string, string> = { h: '/', f: '/feed', c: '/compose', n: '/notifications', s: '/search', d: '/deck', m: '/messages', a: '/archive' };
      if (routes[e.key]) { goto(routes[e.key]); return; }
    }
  }

  const navItems = $derived([
    { href: '/', icon: Home, label: i18n.t.nav.dashboard },
    { href: '/feed', icon: Rss, label: i18n.t.nav.feed },
    { href: '/deck', icon: Columns3, label: i18n.t.nav.deck },
    { href: '/compose', icon: PenSquare, label: i18n.t.nav.compose },
    { href: '/drafts', icon: FileText, label: i18n.t.nav.drafts },
    { href: '/notifications', icon: Bell, label: i18n.t.nav.notifications },
    { href: '/messages', icon: MessageSquare, label: i18n.t.nav.messages },
    { href: '/bookmarks', icon: Bookmark, label: i18n.t.nav.bookmarks, badge: () => bookmarkCount > 0 ? bookmarkCount : 0 },
    { href: '/lists', icon: List, label: i18n.t.nav.lists },
    { href: '/starterpacks', icon: Package, label: i18n.t.nav.starterPacks },
    { href: '/identities', icon: Users, label: i18n.t.nav.identities },
    { href: '/search', icon: Search, label: i18n.t.nav.search },
    { href: '/trending', icon: TrendingUp, label: i18n.t.nav.trending },
    { href: '/archive', icon: Archive, label: i18n.t.nav.archive },
    { href: '/labelers', icon: Tag, label: i18n.t.nav.labelers },
    { href: '/instance', icon: Server, label: i18n.t.nav.instance },
    { href: '/moderation', icon: Shield, label: i18n.t.nav.moderation },
    { href: '/analytics', icon: BarChart3, label: i18n.t.nav.analytics },
    { href: '/settings', icon: Settings, label: i18n.t.nav.settings },
    { href: '/about', icon: Info, label: 'About' },
  ]);

  // Key items for mobile bottom tab bar
  const mobileTabItems = $derived([
    { href: '/feed', icon: Rss, label: i18n.t.nav.feed },
    { href: '/compose', icon: PenSquare, label: i18n.t.nav.post },
    { href: '/notifications', icon: Bell, label: i18n.t.nav.alerts },
    { href: '/search', icon: Search, label: i18n.t.nav.search },
    { href: '/messages', icon: MessageSquare, label: i18n.t.nav.dms },
  ]);

  function isActive(href: string): boolean {
    const path = page.url?.pathname ?? '/';
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />
<KeyboardShortcuts bind:show={showShortcuts} />

<div class="flex h-screen">
  <!-- Desktop sidebar -->
  <nav class="hidden md:flex {collapsed ? 'w-14' : 'w-52'} bg-[var(--color-surface)] border-r border-[var(--color-border)] flex-col transition-all duration-200 flex-shrink-0">
    <div class="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
      {#if !collapsed}
        <div>
          <h1 class="text-base font-bold text-[var(--color-text)]">CrispDeck</h1>
          <p class="text-[10px] text-[var(--color-text-muted)]">Mastodon + Bluesky</p>
        </div>
      {/if}
      <button onclick={() => collapsed = !collapsed} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title={collapsed ? 'Expand' : 'Collapse'}>
        {#if collapsed}<ChevronsRight size={16} />{:else}<ChevronsLeft size={16} />{/if}
      </button>
    </div>
    <ul class="flex-1 py-1 overflow-y-auto">
      {#each navItems as item}
        <li>
          <a
            href={item.href}
            title={collapsed ? item.label : undefined}
            class="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors
              {isActive(item.href)
                ? 'text-[var(--color-text)] bg-[var(--color-primary)]/10 border-r-2 border-[var(--color-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}"
          >
            <item.icon size={16} class="flex-shrink-0" />
            {#if !collapsed}
              <span class="truncate flex-1">{item.label}</span>
              {#if item.badge && item.badge() > 0}
                <span class="ml-auto text-[9px] px-1.5 py-0.5 bg-[var(--color-primary)] text-white rounded-full min-w-[18px] text-center">{item.badge()}</span>
              {/if}
            {/if}
          </a>
        </li>
      {/each}
    </ul>
    {#if !collapsed}
      <div class="px-3 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">v0.2.1</div>
    {/if}
  </nav>

  <!-- Mobile top bar -->
  <div class="md:hidden fixed top-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-2 flex items-center justify-between">
    <h1 class="text-base font-bold">CrispDeck</h1>
    <button onclick={() => mobileMenuOpen = !mobileMenuOpen} class="p-2 text-[var(--color-text-muted)]">
      {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
    </button>
  </div>

  <!-- Mobile slide-out menu -->
  {#if mobileMenuOpen}
    <div class="md:hidden fixed inset-0 z-40 flex" onclick={() => mobileMenuOpen = false}>
      <div class="w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] pt-14 overflow-y-auto" onclick={(e) => e.stopPropagation()}>
        <ul class="py-2">
          {#each navItems as item}
            <li>
              <a
                href={item.href}
                onclick={() => mobileMenuOpen = false}
                class="flex items-center gap-3 px-4 py-3 text-sm transition-colors
                  {isActive(item.href)
                    ? 'text-[var(--color-text)] bg-[var(--color-primary)]/10'
                    : 'text-[var(--color-text-muted)]'}"
              >
                <item.icon size={18} />
                {item.label}
              </a>
            </li>
          {/each}
        </ul>
      </div>
      <div class="flex-1 bg-black/50"></div>
    </div>
  {/if}

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto md:pt-0 pt-12 pb-16 md:pb-0">
    {@render children()}
  </main>

  <!-- Mobile bottom tab bar -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex items-center justify-around px-1 py-1">
    {#each mobileTabItems as item}
      <a
        href={item.href}
        class="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg transition-colors min-w-0 flex-1
          {isActive(item.href)
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-text-muted)]'}"
      >
        <item.icon size={20} />
        <span class="text-[9px] truncate">{item.label}</span>
      </a>
    {/each}
  </nav>
</div>
