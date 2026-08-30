<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Home, Rss, Columns3, PenSquare, Bell, MessageSquare, Bookmark, Users, Search, List, Shield, TrendingUp, Archive, BarChart3, Settings, Info, ChevronsLeft, ChevronsRight, Menu, X, Sun, Moon, Smartphone } from '@lucide/svelte';
  import KeyboardShortcuts from '$lib/components/KeyboardShortcuts.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import ScrollToTop from '$lib/components/ScrollToTop.svelte';
  import AccountSwitcher from '$lib/components/AccountSwitcher.svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { installLogInterceptors } from '$lib/debug-log';
  import { preloadSanitizer } from '$lib/sanitize';
  import { initDensity } from '$lib/density';
  installLogInterceptors();
  preloadSanitizer(); // Start loading DOMPurify before any posts render
  initDensity(); // Apply saved display density CSS custom properties


  let { children } = $props();

  import { onMount, onDestroy } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { getBookmarkCount } from '$lib/bookmarks';

  import type { Account } from '$lib/types';

  let collapsed = $state(false);
  let mobileMenuOpen = $state(false);
  let sidebarAccounts: Account[] = $state([]);
  let mobileMenuClosing = $state(false);
  function closeMobileMenu() {
    mobileMenuClosing = true;
    setTimeout(() => { mobileMenuOpen = false; mobileMenuClosing = false; }, 200);
  }
  let theme = $state<'dark' | 'oled' | 'light'>('dark');

  function toggleTheme() {
    theme = theme === 'dark' ? 'oled' : theme === 'oled' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('crispdeck-theme', theme);
  }
  let showShortcuts = $state(false);
  let offline = $state(false);
  let pendingG = $state(false);
  let _postElsCache: NodeListOf<Element> | null = null;
  let _postElsCacheTs = 0;
  let bookmarkCount = $state(0);
  let unreadMessages = $state(0);

  // Configurable sidebar — simple mode hides advanced items
  const SIMPLE_MODE_HIDDEN = ['/deck', '/identities', '/archive', '/analytics', '/moderation', '/labelers', '/about'];
  const savedSimpleMode = localStorage.getItem('crispdeck-simple-mode') === 'true';
  let simpleMode = $state(savedSimpleMode);
  let navHidden = $state<Set<string>>(new Set(
    savedSimpleMode ? SIMPLE_MODE_HIDDEN : JSON.parse(localStorage.getItem('crispdeck-nav-hidden') ?? '[]')
  ));
  let showNavCustomize = $state(false);

  function toggleSimpleMode() {
    simpleMode = !simpleMode;
    localStorage.setItem('crispdeck-simple-mode', String(simpleMode));
    if (simpleMode) {
      navHidden = new Set(SIMPLE_MODE_HIDDEN);
    } else {
      navHidden = new Set();
    }
    localStorage.setItem('crispdeck-nav-hidden', JSON.stringify([...navHidden]));
  }
  function toggleNavItem(href: string) {
    if (navHidden.has(href)) navHidden.delete(href); else navHidden.add(href);
    navHidden = new Set(navHidden);
    localStorage.setItem('crispdeck-nav-hidden', JSON.stringify([...navHidden]));
  }

  async function getCachedClients() {
    const { initAllClients } = await import('$lib/api/client-factory');
    return await initAllClients();
  }

  // Page transitions via View Transitions API (progressive enhancement)
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    // Determine navigation direction for slide animation
    const fromDepth = window.location.pathname.split('/').filter(Boolean).length;
    const toDepth = navigation.to?.url.pathname.split('/').filter(Boolean).length ?? fromDepth;
    document.documentElement.dataset.navDirection = toDepth > fromDepth ? 'forward' : 'back';
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
        delete document.documentElement.dataset.navDirection;
      });
    });
  });

  let countsInterval: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Restore theme
    const saved = localStorage.getItem('crispdeck-theme') as 'dark' | 'oled' | 'light' | null;
    if (saved) { theme = saved; document.documentElement.setAttribute('data-theme', saved); }

    // Restore display preferences
    const root = document.documentElement;
    const fontMap: Record<string, string> = { system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif", inter: "'Inter', -apple-system, sans-serif", georgia: "Georgia, 'Times New Roman', serif", mono: "'SF Mono', 'Fira Code', monospace" };
    const ff = localStorage.getItem('crispdeck-font-family');
    if (ff && fontMap[ff]) root.style.setProperty('--user-font-family', fontMap[ff]);
    const fs = localStorage.getItem('crispdeck-font-size');
    if (fs) root.style.setProperty('--user-font-size', `${fs}px`);
    const ls = localStorage.getItem('crispdeck-line-spacing');
    if (ls) root.style.setProperty('--user-line-height', ls);
    const cw = localStorage.getItem('crispdeck-content-width');
    if (cw && parseInt(cw) > 0) root.style.setProperty('--user-content-width', `${cw}px`);

    // Offline detection
    offline = !navigator.onLine;
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    bookmarkCount = await getBookmarkCount();
    // Check unread messages on load
    checkUnreadMessages();
    // Refresh counts periodically — skip when tab is hidden to save API calls.
    // NB: Svelte ignores the return value of an *async* onMount callback, so
    // the teardown lives in onDestroy — returning a cleanup here would never
    // run it.
    countsInterval = setInterval(async () => {
      if (document.hidden) return;
      bookmarkCount = await getBookmarkCount();
      checkUnreadMessages();
    }, 60000);
    document.addEventListener('visibilitychange', handleVisibility);
  });

  const handleOnline = () => offline = false;
  const handleOffline = () => offline = true;

  /** Resume immediately when the tab becomes visible after being hidden. */
  function handleVisibility() {
    if (!document.hidden) {
      getBookmarkCount().then(c => bookmarkCount = c);
      checkUnreadMessages();
    }
  }

  onDestroy(() => {
    if (countsInterval) clearInterval(countsInterval);
    countsInterval = undefined;
    if (typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });

  async function checkUnreadMessages() {
    try {
      const { accounts: accts, clients } = await getCachedClients();
      sidebarAccounts = accts;
      const results = await Promise.allSettled(Array.from(clients).map(async ([id, entry]) => {
        const acct = accts.find(a => a.id === id);
        if (!acct) return 0;
        if (acct.platform === 'bluesky' && entry.oauthAgent) {
          const proxyHeaders = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
          const r = await (entry.oauthAgent as any).api.chat.bsky.convo.listConvos({ limit: 50 }, { headers: proxyHeaders });
          return (r.data.convos ?? []).reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0);
        } else if (acct.platform === 'mastodon') {
          const masto = entry.client as any;
          const token = masto.getAccessToken();
          if (token) {
            const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/conversations?limit=40`, { headers: { Authorization: `Bearer ${token}` } });
            if (resp.ok) { const convos = await resp.json(); return convos.filter((c: any) => c.unread).length; }
          }
        }
        return 0;
      }));
      unreadMessages = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
      // Update PWA badge
      if (unreadMessages > 0) (navigator as any).setAppBadge?.(unreadMessages);
      else (navigator as any).clearAppBadge?.();
    } catch {}
  }

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
      const routes: Record<string, string> = { h: '/', f: '/feed', c: '/compose', n: '/notifications', s: '/search', d: '/deck', m: '/messages', a: '/archive', t: '/trending', b: '/bookmarks', p: '/settings', i: '/identities', u: '/catchup' };
      if (routes[e.key]) { goto(routes[e.key]); return; }
    }

    // Vim-style post navigation (j/k/o/l) — cache DOM query, invalidate after 2s
    if (!_postElsCache || Date.now() - _postElsCacheTs > 2000) {
      _postElsCache = document.querySelectorAll('[data-post-uri]');
      _postElsCacheTs = Date.now();
    }
    const postEls = _postElsCache;
    if (postEls.length === 0) return;
    const focused = document.querySelector('[data-post-uri].ring-2') as HTMLElement;
    const currentIdx = focused ? [...postEls].indexOf(focused) : -1;

    if (e.key === 'j' || e.key === 'k') {
      e.preventDefault();
      const nextIdx = e.key === 'j'
        ? Math.min(currentIdx + 1, postEls.length - 1)
        : Math.max(currentIdx - 1, 0);
      focused?.classList.remove('ring-2', 'ring-[var(--color-primary)]');
      const next = postEls[nextIdx] as HTMLElement;
      next.classList.add('ring-2', 'ring-[var(--color-primary)]');
      next.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (focused) {
      if (e.key === 'o') {
        const link = focused.querySelector('a[href*="/thread"], a[href*="/post"]') as HTMLAnchorElement;
        if (link) link.click();
      } else if (e.key === 'l') {
        const likeBtn = focused.querySelector('[title="Like"]') as HTMLButtonElement;
        likeBtn?.click();
      } else if (e.key === 'r') {
        const replyBtn = focused.querySelector('[title="Reply"]') as HTMLButtonElement;
        replyBtn?.click();
      } else if (e.key === 'b' && !pendingG) {
        const boostBtn = focused.querySelector('[title="Boost"]') as HTMLButtonElement;
        boostBtn?.click();
      }
    }
  }

  const navItems = $derived([
    { href: '/', icon: Home, label: i18n.t.nav.dashboard },
    { href: '/feed', icon: Rss, label: i18n.t.nav.feed },
    { href: '/deck', icon: Columns3, label: i18n.t.nav.deck },
    { href: '/compose', icon: PenSquare, label: i18n.t.nav.compose },
    { href: '/notifications', icon: Bell, label: i18n.t.nav.notifications },
    { href: '/messages', icon: MessageSquare, label: i18n.t.nav.messages, badge: () => unreadMessages > 0 ? unreadMessages : 0 },
    { href: '/search', icon: Search, label: i18n.t.nav.search },
    { href: '/bookmarks', icon: Bookmark, label: i18n.t.nav.bookmarks, badge: () => bookmarkCount > 0 ? bookmarkCount : 0 },
    { href: '/lists', icon: List, label: 'Lists & Feeds' },
    { href: '/trending', icon: TrendingUp, label: 'Discover' },
    { href: '/identities', icon: Users, label: i18n.t.nav.identities },
    { href: '/archive', icon: Archive, label: i18n.t.nav.archive },
    { href: '/analytics', icon: BarChart3, label: i18n.t.nav.analytics },
    { href: '/moderation', icon: Shield, label: i18n.t.nav.moderation },
    { href: '/settings', icon: Settings, label: i18n.t.nav.settings },
    { href: '/about', icon: Info, label: 'About' },
  ]);

  // Filtered nav items (respects simple mode / custom hidden items)
  const visibleNavItems = $derived(navItems.filter(i => !navHidden.has(i.href)));

  // Key items for mobile bottom tab bar
  const mobileTabItems = $derived([
    { href: '/feed', icon: Rss, label: i18n.t.nav.feed },
    { href: '/compose', icon: PenSquare, label: i18n.t.nav.post },
    { href: '/notifications', icon: Bell, label: i18n.t.nav.alerts },
    { href: '/search', icon: Search, label: i18n.t.nav.search },
    { href: '/messages', icon: MessageSquare, label: i18n.t.nav.dms },
  ]);

  // Merged routes: sidebar item → also active for these paths
  const mergedRoutes: Record<string, string[]> = {
    '/trending': ['/trending', '/catchup'],
    '/lists': ['/lists', '/feed-builder', '/starterpacks'],
    '/bookmarks': ['/bookmarks', '/reading-lists'],
    '/archive': ['/archive', '/gallery'],
    '/analytics': ['/analytics', '/calendar'],
    '/moderation': ['/moderation', '/labelers'],
    '/compose': ['/compose', '/drafts'],
    '/settings': ['/settings', '/instance'],
  };

  function isActive(href: string): boolean {
    const path = page.url?.pathname ?? '/';
    if (href === '/') return path === '/';
    const routes = mergedRoutes[href];
    if (routes) return routes.some(r => path.startsWith(r));
    return path.startsWith(href);
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />
<KeyboardShortcuts bind:show={showShortcuts} />

<a href="#main-content" class="skip-to-content">Skip to content</a>

<div class="flex h-screen" dir={i18n.dir}>
  <!-- Desktop sidebar -->
  <nav aria-label="Main navigation" class="hidden md:flex {collapsed ? 'w-14' : 'w-52'} bg-[var(--color-surface)] border-r border-[var(--color-border)] flex-col transition-all duration-200 flex-shrink-0">
    <div class="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
      {#if !collapsed}
        <div>
          <h1 class="text-base font-bold text-[var(--color-text)]">CrispDeck</h1>
          <p class="text-[10px] text-[var(--color-text-muted)]">Bluesky + Mastodon + Threads</p>
        </div>
      {/if}
      <div class="flex items-center gap-1">
        <button onclick={toggleTheme} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title={theme === 'dark' ? 'OLED mode' : theme === 'oled' ? 'Light mode' : 'Dark mode'}>
          {#if theme === 'dark'}<Smartphone size={14} />{:else if theme === 'oled'}<Sun size={14} />{:else}<Moon size={14} />{/if}
        </button>
        <button onclick={() => collapsed = !collapsed} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title={collapsed ? 'Expand' : 'Collapse'}>
          {#if collapsed}<ChevronsRight size={16} />{:else}<ChevronsLeft size={16} />{/if}
        </button>
      </div>
    </div>
    <ul class="flex-1 py-1 overflow-y-auto" role="list">
      {#each visibleNavItems as item}
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
    <!-- Account switcher -->
    <div class="px-2 py-1.5 border-t border-[var(--color-border)]">
      <AccountSwitcher accounts={sidebarAccounts} {collapsed} />
    </div>
    {#if !collapsed}
      <div class="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between">
        <span class="text-[10px] text-[var(--color-text-muted)]">v{__VERSION__}</span>
        <button onclick={() => showNavCustomize = !showNavCustomize} class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Customize sidebar">
          <Settings size={12} />
        </button>
      </div>
      {#if showNavCustomize}
        <div class="px-3 py-2 border-t border-[var(--color-border)] space-y-1 max-h-60 overflow-y-auto">
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
            <input type="checkbox" checked={simpleMode} onchange={toggleSimpleMode} class="rounded" />
            Simple mode
          </label>
          <hr class="border-[var(--color-border)]" />
          {#each navItems as item}
            {#if item.href !== '/' && item.href !== '/settings'}
              <label class="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] cursor-pointer">
                <input type="checkbox" checked={!navHidden.has(item.href)} onchange={() => toggleNavItem(item.href)} class="rounded" />
                {item.label}
              </label>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  </nav>

  <!-- Mobile top bar (condensed single row) -->
  <div class="md:hidden fixed top-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 py-1.5 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <button onclick={() => mobileMenuOpen = !mobileMenuOpen} class="p-1 text-[var(--color-text-muted)]">
        {#if mobileMenuOpen}<X size={18} />{:else}<Menu size={18} />{/if}
      </button>
      <a href="/" class="text-sm font-bold text-[var(--color-text)]">CrispDeck</a>
    </div>
    <div class="flex items-center gap-1">
      <button onclick={toggleTheme} class="p-1.5 text-[var(--color-text-muted)]" title="Toggle theme">
        {#if theme === 'dark'}<Smartphone size={14} />{:else if theme === 'oled'}<Sun size={14} />{:else}<Moon size={14} />{/if}
      </button>
      <a href="/notifications" class="p-1.5 text-[var(--color-text-muted)]">
        <Bell size={14} />
      </a>
    </div>
  </div>

  <!-- Mobile slide-out menu -->
  {#if mobileMenuOpen}
    <div class="md:hidden fixed inset-0 z-40 flex {mobileMenuClosing ? 'mobile-menu-backdrop-out' : 'mobile-menu-backdrop'}">
      <div class="w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] pt-14 overflow-y-auto {mobileMenuClosing ? 'mobile-menu-slide-out' : 'mobile-menu-slide'}">
        <ul class="py-2">
          {#each visibleNavItems as item}
            <li>
              <a
                href={item.href}
                onclick={closeMobileMenu}
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
      <button type="button" class="flex-1 mobile-menu-overlay" aria-label="Close menu" onclick={closeMobileMenu}></button>
    </div>
  {/if}

  <!-- Main content -->
  <main id="main-content" class="flex-1 overflow-y-auto md:pt-0 pt-10 pb-14 md:pb-0">
    {#if offline}
      <div class="bg-yellow-900/50 border-b border-yellow-700 px-4 py-2 text-center text-xs text-yellow-200 flex items-center justify-center gap-2">
        <span>You're offline — some features may be unavailable</span>
        <button onclick={() => offline = false} class="p-0.5 hover:bg-yellow-800/50 rounded" aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>
    {/if}
    <ErrorBoundary>
      {@render children()}
    </ErrorBoundary>
  </main>

  <ToastContainer />
  <ScrollToTop />

  <!-- Mobile bottom tab bar (compact) -->
  <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--color-surface)] border-t border-[var(--color-border)] flex items-center justify-around px-1 safe-area-bottom">
    {#each mobileTabItems as item}
      <a
        href={item.href}
        class="flex flex-col items-center gap-0 px-1 py-1 rounded-lg transition-colors min-w-0 flex-1
          {isActive(item.href)
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-text-muted)]'}"
      >
        <item.icon size={18} />
        <span class="text-[8px] truncate leading-tight">{item.label}</span>
      </a>
    {/each}
  </nav>
</div>
