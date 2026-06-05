<script lang="ts">
  import { AlertTriangle, RefreshCw } from '@lucide/svelte';

  let { children }: { children: any } = $props();
</script>

<svelte:boundary onerror={(e) => console.error('Page error:', e)}>
  {@render children()}

  {#snippet failed(error, reset)}
    <div class="p-6 max-w-lg mx-auto mt-12">
      <div class="bg-[var(--color-surface)] rounded-xl border border-red-900/50 p-6 text-center">
        <AlertTriangle size={48} class="text-red-400 mx-auto mb-4" />
        <h2 class="text-lg font-bold mb-2">Something went wrong</h2>
        <p class="text-sm text-[var(--color-text-muted)] mb-4">
          {error?.message || 'An unexpected error occurred.'}
        </p>
        <div class="flex items-center justify-center gap-3">
          <button
            onclick={reset}
            class="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-medium rounded-md transition-colors"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
          <a
            href="/"
            class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Go Home
          </a>
        </div>
        <details class="mt-4 text-left">
          <summary class="text-xs text-[var(--color-text-muted)] cursor-pointer">Technical details</summary>
          <pre class="mt-2 p-3 bg-[var(--color-bg)] rounded-md text-[10px] text-red-300 overflow-x-auto whitespace-pre-wrap">{error?.stack || error}</pre>
        </details>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
