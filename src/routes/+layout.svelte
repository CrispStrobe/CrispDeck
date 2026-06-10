<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Home, Rss, Columns3, PenSquare, Bell, MessageSquare, Bookmark, Users, Search, List, Shield, TrendingUp, Archive, BarChart3, Settings, Info, ChevronsLeft, ChevronsRight, Menu, X, Sun, Moon, Smartphone } from '@lucide/svelte';
  import KeyboardShortcuts from '$lib/components/KeyboardShortcuts.svelte';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { installLogInterceptors } from '$lib/debug-log';
  installLogInterceptors();

  declare const __VERSION__: string;

  let { children } = $props();

  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { getBookmarkCount } from '$lib/bookmarks';

  let collapsed = $state(false);
  let mobileMenuOpen = $state(false);
  let theme = $state<'dark' | 'oled' | 'light'>('dark');

  function toggleTheme() {
    theme = theme === 'dark' ? 'oled' : theme === 'oled' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('crispdeck-theme', theme);
  }
  let showShortcuts = $state(false);
  let offline = $state(false);
  let pendingG = $state(false);
  let bookmarkCount = $state(0);
  let unreadMessages = $state(0);

  // Cache initAllClients result to avoid rebuilding clients every 30s
  let cachedClients: { accounts: any[]; clients: Map<number, any> } | null = null;
  let clientsCacheTime = 0;
  const CLIENTS_CACHE_TTL = 300000; // 5 minutes

  async function getCachedClients() {
    const now = Date.now();
    if (!cachedClients || now - clientsCacheTime > CLIENTS_CACHE_TTL) {
      const { initAllClients } = await import('$lib/api/client-factory');
      cachedClients = await initAllClients();
      clientsCacheTime = now;
    }
    return cachedClients;
  }

  // Page transitions via View Transitions API (progressive enhancement)
  onNavigate((navigation) => {
    if (!document.startViewTransition) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  onMount(async () => {
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Restore theme
    const saved = localStorage.getItem('crispdeck-theme') as 'dark' | 'oled' | 'light' | null;
    if (saved) { theme = saved; document.documentElement.setAttribute('data-theme', saved); }

    // Offline detection
    offline = !navigator.onLine;
    const handleOnline = () => offline = false;
    const handleOffline = () => offline = true;
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    bookmarkCount = await getBookmarkCount();
    // Check unread messages on load
    checkUnreadMessages();
    // Refresh counts periodically
    const interval = setInterval(async () => {
      bookmarkCount = await getBookmarkCount();
      checkUnreadMessages();
    }, 30000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  });

  async function checkUnreadMessages() {
    try {
      const { accounts: accts, clients } = await getCachedClients();
      let count = 0;
      for (const [id, entry] of clients) {
        const acct = accts.find(a => a.id === id);
        if (!acct) continue;
        if (acct.platform === 'bluesky' && entry.oauthAgent) {
          try {
            const proxyHeaders = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
            const r = await (entry.oauthAgent as any).api.chat.bsky.convo.listConvos({ limit: 50 }, { headers: proxyHeaders });
            count += (r.data.convos ?? []).reduce((s: number, c: any) => s + (c.unreadCount ?? 0), 0);
          } catch {}
        } else if (acct.platform === 'mastodon') {
          const masto = entry.client as any;
          const token = masto.getAccessToken();
          if (token) {
            try {
              const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/conversations?limit=40`, { headers: { Authorization: `Bearer ${token}` } });
              if (resp.ok) { const convos = await resp.json(); count += convos.filter((c: any) => c.unread).length; }
            } catch {}
          }
        }
      }
      unreadMessages = count;
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

    // Vim-style post navigation (j/k/o/l)
    const postEls = document.querySelectorAll('[data-post-uri]');
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
      <div class="px-3 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">v{__VERSION__}</div>
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
    <div class="md:hidden fixed inset-0 z-40 flex mobile-menu-backdrop" onclick={() => mobileMenuOpen = false}>
      <div class="w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)] pt-14 overflow-y-auto mobile-menu-slide" onclick={(e) => e.stopPropagation()}>
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
      <div class="flex-1 mobile-menu-overlay"></div>
    </div>
  {/if}

  <!-- Main content -->
  <main id="main-content" class="flex-1 overflow-y-auto md:pt-0 pt-10 pb-14 md:pb-0" role="main">
    {#if offline}
      <div class="bg-yellow-900/50 border-b border-yellow-700 px-4 py-2 text-center text-xs text-yellow-200">
        You're offline — some features may be unavailable
      </div>
    {/if}
    <ErrorBoundary>
      {@render children()}
    </ErrorBoundary>
  </main>

  <ToastContainer />

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
