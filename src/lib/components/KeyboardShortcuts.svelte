<script lang="ts">
  import { X } from '@lucide/svelte';

  let { show = $bindable(false) }: { show: boolean } = $props();

  const shortcuts = [
    { section: 'Navigation', items: [
      { key: 'g h', desc: 'Go to Home/Dashboard' },
      { key: 'g f', desc: 'Go to Feed' },
      { key: 'g c', desc: 'Go to Compose' },
      { key: 'g n', desc: 'Go to Notifications' },
      { key: 'g s', desc: 'Go to Search' },
      { key: 'g d', desc: 'Go to Deck' },
      { key: 'g m', desc: 'Go to Messages' },
    ]},
    { section: 'Compose', items: [
      { key: 'Ctrl+Enter', desc: 'Submit post' },
      { key: 'Esc', desc: 'Close popups' },
    ]},
    { section: 'General', items: [
      { key: '?', desc: 'Show this help' },
    ]},
  ];
</script>

{#if show}
  <div class="fixed inset-0 z-[100] flex items-center justify-center" onclick={() => show = false}>
    <div class="absolute inset-0 bg-black/60"></div>
    <div class="relative bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold">Keyboard Shortcuts</h2>
        <button onclick={() => show = false} class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <X size={18} />
        </button>
      </div>
      {#each shortcuts as section}
        <h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-4 mb-2">{section.section}</h3>
        {#each section.items as item}
          <div class="flex items-center justify-between py-1.5">
            <span class="text-sm text-[var(--color-text-muted)]">{item.desc}</span>
            <div class="flex items-center gap-1">
              {#each item.key.split('+') as part}
                <kbd class="px-1.5 py-0.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[10px] font-mono">{part}</kbd>
              {/each}
            </div>
          </div>
        {/each}
      {/each}
    </div>
  </div>
{/if}
