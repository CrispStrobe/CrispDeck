<!--
  Muted words — self-contained: the list is persisted by $lib/muted-words,
 * so this component owns the state outright rather than taking props.
-->
<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { EyeOff, Plus, Trash2 } from '@lucide/svelte';
  import { listMutedWords, addMutedWord, removeMutedWord, toggleMutedWord, type MutedWord } from '$lib/muted-words';

  let mutedWords: MutedWord[] = $state(listMutedWords());
  let newMutedWord = $state('');
  let newMutedIsRegex = $state(false);
</script>

<!-- Muted Words -->
<section class="mb-8">
  <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
    <EyeOff size={18} />
    {i18n.t.settings.mutedWordsTitle}
  </h2>
  <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.mutedWordsHint}</p>

    {#if mutedWords.length > 0}
      <div class="space-y-1">
        {#each mutedWords as word}
          <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md {!word.enabled ? 'opacity-50' : ''}">
            <div class="flex items-center gap-2 min-w-0">
              <button onclick={() => { mutedWords = toggleMutedWord(word.id); }} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <EyeOff size={12} />
              </button>
              <span class="text-sm truncate">{word.value}</span>
              {#if word.isRegex}
                <span class="text-[9px] px-1 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">regex</span>
              {/if}
            </div>
            <button
              onclick={() => { mutedWords = removeMutedWord(word.id); }}
              class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1 flex-shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex gap-2">
      <input
        type="text"
        bind:value={newMutedWord}
        placeholder={i18n.t.settings.mutedWordPlaceholder}
        class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        onkeydown={(e) => { if (e.key === 'Enter' && newMutedWord.trim()) { mutedWords = addMutedWord(newMutedWord.trim(), newMutedIsRegex); newMutedWord = ''; } }}
      />
      <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] cursor-pointer whitespace-nowrap">
        <input type="checkbox" bind:checked={newMutedIsRegex} class="w-3 h-3 accent-[var(--color-primary)]" />
        regex
      </label>
      <button
        onclick={() => {
          if (newMutedWord.trim()) {
            mutedWords = addMutedWord(newMutedWord.trim(), newMutedIsRegex);
            newMutedWord = '';
          }
        }}
        disabled={!newMutedWord.trim()}
        class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
      >
        <Plus size={12} />
      </button>
    </div>
  </div>
</section>
