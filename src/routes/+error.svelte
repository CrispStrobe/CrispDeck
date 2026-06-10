<script lang="ts">
  import { page } from '$app/state';
  import { Home, ArrowLeft, Search } from '@lucide/svelte';
</script>

<svelte:head><title>CrispDeck — {page.status}</title></svelte:head>

<div class="flex items-center justify-center min-h-[70vh] px-4">
  <div class="text-center max-w-md">
    <p class="text-6xl font-bold text-[var(--color-primary)] mb-2">{page.status}</p>
    <h1 class="text-xl font-semibold mb-2">
      {page.status === 404 ? 'Page not found' : 'Something went wrong'}
    </h1>
    <p class="text-sm text-[var(--color-text-muted)] mb-8">
      {#if page.status === 404}
        The page you're looking for doesn't exist or has been moved.
      {:else}
        {page.error?.message || 'An unexpected error occurred.'}
      {/if}
    </p>
    <div class="flex items-center justify-center gap-3">
      <a
        href="/"
        class="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white rounded-lg text-sm font-medium transition-colors"
      >
        <Home size={16} />
        Dashboard
      </a>
      <a
        href="/feed"
        class="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-lg text-sm font-medium transition-colors"
      >
        <ArrowLeft size={16} />
        Feed
      </a>
      <a
        href="/search"
        class="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-lg text-sm font-medium transition-colors"
      >
        <Search size={16} />
        Search
      </a>
    </div>
  </div>
</div>
