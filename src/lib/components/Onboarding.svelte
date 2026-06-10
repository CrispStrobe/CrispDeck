<script lang="ts">
  import { Rss, Columns3, Globe, ArrowRight, Zap } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';

  interface Props {
    ongetstarted: () => void;
  }

  let { ongetstarted }: Props = $props();

  let step = $state(0);

  const features = [
    {
      icon: Globe,
      title: 'All your networks, one place',
      desc: 'Connect Bluesky, Mastodon, and Threads — see everything in a unified timeline.',
    },
    {
      icon: Columns3,
      title: 'TweetDeck-style deck',
      desc: 'Multi-column layout with 14 column types — timeline, mentions, hashtags, keyword monitoring, and more.',
    },
    {
      icon: Rss,
      title: 'Write once, post everywhere',
      desc: 'Crosspost with smart thread splitting, per-platform character limits, and media support.',
    },
    {
      icon: Zap,
      title: 'Live streaming & analytics',
      desc: 'Real-time posts via firehose, engagement insights, identity mapping across networks.',
    },
  ];

  const feature = $derived(features[step]);
</script>

<div class="min-h-[70vh] flex flex-col items-center justify-center px-4">
  <div class="max-w-lg w-full text-center">
    <!-- App icon + title -->
    <div class="mb-8">
      <img src="/favicon.png" alt="CrispDeck" class="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg" />
      <h1 class="text-3xl font-bold mb-2">Welcome to CrispDeck</h1>
      <p class="text-[var(--color-text-muted)]">Your cross-platform social media command center</p>
    </div>

    <!-- Feature carousel -->
    <div class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6 mb-6">
      <div class="flex flex-col items-center gap-3">
        <div class="w-12 h-12 rounded-xl bg-[var(--color-primary)]/15 flex items-center justify-center">
          <feature.icon size={24} class="text-[var(--color-primary)]" />
        </div>
        <h3 class="text-lg font-semibold">{feature.title}</h3>
        <p class="text-sm text-[var(--color-text-muted)] max-w-sm">{feature.desc}</p>
      </div>

      <!-- Dots -->
      <div class="flex justify-center gap-1.5 mt-5">
        {#each features as _, idx}
          <button
            onclick={() => step = idx}
            class="w-2 h-2 rounded-full transition-colors {idx === step ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}"
            aria-label="Step {idx + 1}"
          ></button>
        {/each}
      </div>
    </div>

    <!-- CTA -->
    <div class="space-y-3">
      <button
        onclick={ongetstarted}
        class="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-medium rounded-lg transition-colors"
      >
        {i18n.t.settings.addAccount}
        <ArrowRight size={16} />
      </button>

      <p class="text-xs text-[var(--color-text-muted)]">
        Connect a Bluesky, Mastodon, or Threads account to get started.
        <br />
        Press <kbd class="px-1 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px]">?</kbd> anytime for keyboard shortcuts.
      </p>
    </div>
  </div>
</div>
