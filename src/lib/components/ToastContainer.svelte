<script lang="ts">
  import { getToasts, dismissToast, type ToastType } from '$lib/toast.svelte';
  import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from '@lucide/svelte';

  const iconMap: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle,
  };

  const colorMap: Record<ToastType, string> = {
    success: 'bg-green-900/90 border-green-700 text-green-100',
    error: 'bg-red-900/90 border-red-700 text-red-100',
    info: 'bg-blue-900/90 border-blue-700 text-blue-100',
    warning: 'bg-yellow-900/90 border-yellow-700 text-yellow-100',
  };

  const iconColorMap: Record<ToastType, string> = {
    success: 'text-green-400',
    error: 'text-red-400',
    info: 'text-blue-400',
    warning: 'text-yellow-400',
  };
</script>

{#if getToasts().length > 0}
  <div
    class="fixed bottom-16 md:bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    aria-live="polite"
    aria-label="Notifications"
  >
    {#each getToasts() as t (t.id)}
      {@const Icon = iconMap[t.type]}
      <div
        class="pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-lg border shadow-lg backdrop-blur-sm text-sm {colorMap[t.type]} toast-enter"
        role="alert"
      >
        <Icon size={16} class="flex-shrink-0 mt-0.5 {iconColorMap[t.type]}" />
        <span class="flex-1 min-w-0">{t.message}</span>
        <button
          onclick={() => dismissToast(t.id)}
          class="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-enter {
    animation: toast-slide-in 0.25s ease-out;
  }
  @keyframes toast-slide-in {
    from { opacity: 0; transform: translateY(12px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast-enter { animation: none; }
  }
</style>
