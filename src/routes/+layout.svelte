<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { Home, Rss, Columns3, PenSquare, FileText, Bell, MessageSquare, Users, Search, List, Package, Shield, BarChart3, Settings, ChevronsLeft, ChevronsRight } from '@lucide/svelte';

  let { children } = $props();

  let collapsed = $state(false);

  const navItems = [
    { href: '/', icon: Home, label: 'Dashboard' },
    { href: '/feed', icon: Rss, label: 'Feed' },
    { href: '/deck', icon: Columns3, label: 'Deck' },
    { href: '/compose', icon: PenSquare, label: 'Compose' },
    { href: '/drafts', icon: FileText, label: 'Drafts' },
    { href: '/notifications', icon: Bell, label: 'Notifications' },
    { href: '/messages', icon: MessageSquare, label: 'Messages' },
    { href: '/lists', icon: List, label: 'Lists & Feeds' },
    { href: '/starterpacks', icon: Package, label: 'Starter Packs' },
    { href: '/identities', icon: Users, label: 'Identities' },
    { href: '/search', icon: Search, label: 'Search' },
    { href: '/moderation', icon: Shield, label: 'Moderation' },
    { href: '/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/settings', icon: Settings, label: 'Settings' },
  ];

  function isActive(href: string): boolean {
    const path = page.url?.pathname ?? '/';
    if (href === '/') return path === '/';
    return path.startsWith(href);
  }
</script>

<div class="flex h-screen">
  <!-- Sidebar -->
  <nav class="{collapsed ? 'w-14' : 'w-52'} bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col transition-all duration-200 flex-shrink-0">
    <div class="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
      {#if !collapsed}
        <div>
          <h1 class="text-base font-bold text-[var(--color-text)]">CrispDeck</h1>
          <p class="text-[10px] text-[var(--color-text-muted)]">Mastodon + Bluesky</p>
        </div>
      {/if}
      <button onclick={() => collapsed = !collapsed} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
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
              <span class="truncate">{item.label}</span>
            {/if}
          </a>
        </li>
      {/each}
    </ul>
    {#if !collapsed}
      <div class="px-3 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
        v0.1.0
      </div>
    {/if}
  </nav>

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
