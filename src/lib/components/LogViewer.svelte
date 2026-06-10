<script lang="ts">
  import { X, RefreshCw, Trash2, Download, Search, ArrowDown } from '@lucide/svelte';
  import { getLogs, clearLogs, getLogCount, type LogEntry } from '$lib/debug-log';

  let { show = $bindable(false) }: { show: boolean } = $props();

  let logs: LogEntry[] = $state([]);
  let filter: 'all' | 'error' | 'warn' | 'info' = $state('all');
  let searchTerm = $state('');
  let lineCount = $state(200);
  let followLog = $state(true);
  let logEl: HTMLDivElement | undefined = $state();

  const filtered = $derived(
    logs
      .filter(e => filter === 'all' || e.level === filter)
      .filter(e => !searchTerm || e.message.toLowerCase().includes(searchTerm.toLowerCase()) || e.source?.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, lineCount)
  );

  const errorCount = $derived(logs.filter(e => e.level === 'error').length);
  const warnCount = $derived(logs.filter(e => e.level === 'warn').length);
  const infoCount = $derived(logs.filter(e => e.level === 'info').length);

  function refresh() {
    logs = getLogs();
  }

  function clear() {
    clearLogs();
    logs = [];
  }

  function exportLogs() {
    const text = filtered.map(e =>
      `[${e.timestamp}] [${e.level.toUpperCase()}]${e.source ? ` [${e.source}]` : ''} ${e.message}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crispdeck-logs-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function scrollToBottom() {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  // Auto-scroll when following
  $effect(() => {
    if (followLog && filtered.length > 0 && logEl) {
      requestAnimationFrame(() => {
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
      });
    }
  });

  // Load when shown
  $effect(() => {
    if (show) refresh();
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    aria-label="Log Viewer"
    tabindex="-1"
    onclick={() => show = false}
    onkeydown={(e) => { if (e.key === 'Escape') show = false; }}
  >
    <div class="absolute inset-0 bg-black/60"></div>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <div
      class="relative bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-2xl flex flex-col mx-4 w-full max-w-4xl"
      style="height: 80vh"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
        <div>
          <h2 class="text-base font-bold">Log Viewer</h2>
          <p class="text-[10px] text-[var(--color-text-muted)]">
            {logs.length} entries · browser console capture
          </p>
        </div>
        <div class="flex items-center gap-2">
          <!-- Search -->
          <div class="relative">
            <Search size={12} class="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              bind:value={searchTerm}
              placeholder="Filter..."
              class="pl-7 pr-2 py-1 text-[11px] w-32 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          <!-- Line count -->
          <select
            bind:value={lineCount}
            class="px-1.5 py-1 text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text-muted)]"
          >
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>

          <!-- Follow toggle -->
          <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] cursor-pointer">
            <input type="checkbox" bind:checked={followLog} class="w-3 h-3 cursor-pointer" />
            Follow
          </label>

          <!-- Actions -->
          <button onclick={refresh} class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button onclick={exportLogs} class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors" title="Export">
            <Download size={14} />
          </button>
          <button onclick={clear} class="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)] transition-colors" title="Clear all">
            <Trash2 size={14} />
          </button>
          <button onclick={() => show = false} class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <!-- Level filter tabs -->
      <div class="flex items-center gap-1 px-5 py-2 border-b border-[var(--color-border)]">
        <button
          onclick={() => filter = 'all'}
          class="px-2.5 py-1 text-[10px] font-medium rounded transition-colors {filter === 'all' ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >All ({logs.length})</button>
        <button
          onclick={() => filter = 'error'}
          class="px-2.5 py-1 text-[10px] font-medium rounded transition-colors {filter === 'error' ? 'bg-red-500/20 text-red-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >Errors ({errorCount})</button>
        <button
          onclick={() => filter = 'warn'}
          class="px-2.5 py-1 text-[10px] font-medium rounded transition-colors {filter === 'warn' ? 'bg-yellow-500/20 text-yellow-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >Warnings ({warnCount})</button>
        <button
          onclick={() => filter = 'info'}
          class="px-2.5 py-1 text-[10px] font-medium rounded transition-colors {filter === 'info' ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}"
        >Info ({infoCount})</button>
      </div>

      <!-- Log content -->
      <div bind:this={logEl} class="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed bg-[var(--color-bg)]">
        {#if filtered.length === 0}
          <div class="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
            {logs.length === 0 ? 'No log entries yet. Errors and warnings are captured automatically.' : 'No entries match filter.'}
          </div>
        {:else}
          {#each filtered as entry, i}
            <div class="flex gap-2 py-0.5 hover:bg-[var(--color-surface)]/30 rounded px-1 -mx-1 {entry.level === 'error' ? 'text-red-400' : entry.level === 'warn' ? 'text-yellow-400' : 'text-blue-400/70'}">
              <span class="flex-shrink-0 text-[var(--color-text-muted)]/50 select-none w-16">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span class="flex-shrink-0 uppercase font-bold w-10 text-[10px]">{entry.level}</span>
              {#if entry.source}
                <span class="flex-shrink-0 text-[var(--color-primary)]/50 text-[10px]">[{entry.source}]</span>
              {/if}
              <span class="break-all whitespace-pre-wrap">{entry.message}</span>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-5 py-2 border-t border-[var(--color-border)]">
        <span class="text-[10px] text-[var(--color-text-muted)]">
          {filtered.length} / {logs.length} entries shown
          {#if searchTerm}· filtered by "{searchTerm}"{/if}
        </span>
        <div class="flex items-center gap-2">
          <button onclick={scrollToBottom} class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            <ArrowDown size={10} /> Bottom
          </button>
          <button onclick={() => show = false} class="px-3 py-1 text-[11px] bg-[var(--color-surface-hover)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
