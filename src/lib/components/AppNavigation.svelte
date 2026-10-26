<script lang="ts">
  import type { Home } from '@lucide/svelte';
  import { base } from '$app/paths';
  import { i18n } from '$lib/i18n.svelte';
  import { NAV_GROUPS, PRIMARY_ROUTES } from '$lib/navigation';
  import { isNavItemActive } from '$lib/nav-active';
  type Item = { href: string; icon: typeof Home; label: string; badge?: () => number };
  let { items, simple, collapsed = false, path, onnavigate }: {
    items: Item[]; simple: boolean; collapsed?: boolean; path: string; onnavigate?: () => void;
  } = $props();
  const primary = $derived(items.filter(i => i.href !== '/compose' && (!simple || PRIMARY_ROUTES.includes(i.href))));
</script>

{#snippet link(item: Item)}
  <a href={`${base}${item.href}`.replace(/\/$/, '') || '/'} onclick={onnavigate}
    aria-current={isNavItemActive(item.href, path) ? 'page' : undefined}
    title={collapsed ? item.label : undefined}
    class="flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors {isNavItemActive(item.href, path) ? 'text-[var(--color-primary-text)] bg-[var(--color-primary)]/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}">
    <item.icon size={17} class="flex-shrink-0" />
    {#if !collapsed}
      <span class="truncate flex-1">{item.label}</span>
      {#if item.badge && item.badge() > 0}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-primary)] text-white">{item.badge()}</span>{/if}
    {/if}
  </a>
{/snippet}

<ul class="py-1" role="list">
  {#each primary as item}<li>{@render link(item)}</li>{/each}
  {#if simple}
    {#each NAV_GROUPS as group}
      {@const children = items.filter(i => group.routes.includes(i.href))}
      {#if children.length}
        <li>
          <details open={children.some(i => isNavItemActive(i.href, path))}>
            <summary class="px-3 py-2.5 text-xs font-semibold cursor-pointer text-[var(--color-text-muted)]" title={i18n.t.workflow[group.key]}>
              {collapsed ? i18n.t.workflow[group.key].slice(0, 1) : i18n.t.workflow[group.key]}
            </summary>
            <ul class={collapsed ? '' : 'ml-2 border-l border-[var(--color-border)]'}>
              {#each children as item}<li>{@render link(item)}</li>{/each}
            </ul>
          </details>
        </li>
      {/if}
    {/each}
  {/if}
</ul>
