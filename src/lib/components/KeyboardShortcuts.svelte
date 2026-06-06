<script lang="ts">
  import { X, Mic } from '@lucide/svelte';

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
      { key: 'g a', desc: 'Go to Archive' },
      { key: 'g t', desc: 'Go to Trending' },
      { key: 'g b', desc: 'Go to Bookmarks' },
      { key: 'g p', desc: 'Go to Settings' },
      { key: 'g i', desc: 'Go to Identities' },
      { key: 'g u', desc: 'Go to Catch Up' },
    ]},
    { section: 'Posts (vim-style)', items: [
      { key: 'j', desc: 'Next post' },
      { key: 'k', desc: 'Previous post' },
      { key: 'o', desc: 'Open post / thread' },
      { key: 'l', desc: 'Like post' },
      { key: 'r', desc: 'Reply to post' },
      { key: 'b', desc: 'Boost / repost' },
    ]},
    { section: 'Compose', items: [
      { key: 'Ctrl+Enter', desc: 'Submit post' },
      { key: 'Esc', desc: 'Close popups' },
    ]},
    { section: 'General', items: [
      { key: '?', desc: 'Show this help' },
    ]},
  ];

  const voiceCommands = [
    { phrase: '"go to feed"', desc: 'Navigate to feed' },
    { phrase: '"new post"', desc: 'Open compose' },
    { phrase: '"open settings"', desc: 'Open settings' },
    { phrase: '"go to notifications"', desc: 'Show notifications' },
    { phrase: '"open messages"', desc: 'Open messages' },
    { phrase: '"show bookmarks"', desc: 'Open bookmarks' },
    { phrase: '"go to trending"', desc: 'Show trending' },
    { phrase: '"scroll up"', desc: 'Scroll to top' },
    { phrase: '"scroll down"', desc: 'Scroll down' },
    { phrase: '"go back"', desc: 'Go back' },
    { phrase: '"go home"', desc: 'Dashboard' },
  ];
</script>

{#if show}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1" onclick={() => show = false} onkeydown={(e) => { if (e.key === 'Escape') show = false; }}>
    <div class="absolute inset-0 bg-black/60"></div>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
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

      <h3 class="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mt-6 mb-2 flex items-center gap-1.5">
        <Mic size={12} /> Voice Commands (while dictating)
      </h3>
      <p class="text-[10px] text-[var(--color-text-muted)] mb-2">Speak these while the mic is active in Compose. Also works in German.</p>
      {#each voiceCommands as cmd}
        <div class="flex items-center justify-between py-1">
          <span class="text-sm text-[var(--color-text-muted)]">{cmd.desc}</span>
          <span class="text-[10px] text-[var(--color-primary)] font-mono">{cmd.phrase}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}
