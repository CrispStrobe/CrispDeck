<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { Home, Rss, PenSquare, FileText, Bell, Users, Search, BarChart3, Settings } from '@lucide/svelte';

  let { children } = $props();

  const navItems = [
    { href: '/', icon: Home, label: 'Dashboard' },
    { href: '/feed', icon: Rss, label: 'Feed' },
    { href: '/compose', icon: PenSquare, label: 'Compose' },
    { href: '/drafts', icon: FileText, label: 'Drafts' },
    { href: '/notifications', icon: Bell, label: 'Notifications' },
    { href: '/identities', icon: Users, label: 'Identities' },
    { href: '/search', icon: Search, label: 'Search' },
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
  <nav class="w-56 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col">
    <div class="p-4 border-b border-[var(--color-border)]">
      <h1 class="text-lg font-bold text-[var(--color-text)]">CrispDeck</h1>
      <p class="text-xs text-[var(--color-text-muted)]">Mastodon + Bluesky</p>
    </div>
    <ul class="flex-1 py-2">
      {#each navItems as item}
        <li>
          <a
            href={item.href}
            class="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
              {isActive(item.href)
                ? 'text-[var(--color-text)] bg-[var(--color-primary)]/10 border-r-2 border-[var(--color-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}"
          >
            <item.icon size={18} />
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
    <div class="p-3 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
      v0.1.0
    </div>
  </nav>

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
