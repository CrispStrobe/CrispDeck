<script lang="ts">
  import '../app.css';
  import { Home, Rss, PenSquare, Users, Search, BarChart3, Settings } from '@lucide/svelte';

  let { children } = $props();

  const navItems = [
    { href: '/', icon: Home, label: 'Dashboard' },
    { href: '/feed', icon: Rss, label: 'Feed' },
    { href: '/compose', icon: PenSquare, label: 'Compose' },
    { href: '/identities', icon: Users, label: 'Identities' },
    { href: '/search', icon: Search, label: 'Search' },
    { href: '/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/settings', icon: Settings, label: 'Settings' },
  ];
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
            class="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
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
