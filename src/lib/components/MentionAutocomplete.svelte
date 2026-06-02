<script lang="ts">
  import { searchMentions, type MentionSuggestion } from '$lib/compose/mentions';

  let {
    textarea,
    text = $bindable(''),
  }: {
    textarea: HTMLTextAreaElement | undefined;
    text: string;
  } = $props();

  let suggestions: MentionSuggestion[] = $state([]);
  let showPopup = $state(false);
  let selectedIndex = $state(0);
  let mentionStart = $state(-1);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function getCurrentMention(): string | null {
    if (!textarea) return null;
    const cursor = textarea.selectionStart;
    const before = text.substring(0, cursor);

    // Find the @ that starts the current mention
    const match = before.match(/@([\w.-]*)$/);
    if (!match) return null;

    mentionStart = before.length - match[0].length;
    return match[1];
  }

  export function handleInput() {
    const query = getCurrentMention();
    if (!query || query.length < 2) {
      showPopup = false;
      suggestions = [];
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      suggestions = await searchMentions(query);
      showPopup = suggestions.length > 0;
      selectedIndex = 0;
    }, 200);
  }

  export function handleKeydown(event: KeyboardEvent) {
    if (!showPopup) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % suggestions.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (showPopup && suggestions.length > 0) {
        event.preventDefault();
        selectSuggestion(suggestions[selectedIndex]);
      }
    } else if (event.key === 'Escape') {
      showPopup = false;
    }
  }

  function selectSuggestion(suggestion: MentionSuggestion) {
    if (!textarea) return;

    const cursor = textarea.selectionStart;
    // Use the identity name as the mention text, with a unique marker
    // The actual handle resolution happens at post time per platform
    const displayHandle = suggestion.identityName ?? suggestion.handles.bluesky ?? suggestion.handles.mastodon ?? '';
    const mentionText = `@${displayHandle.replace(/\s+/g, '')}`;

    const before = text.substring(0, mentionStart);
    const after = text.substring(cursor);
    text = `${before}${mentionText} ${after}`;

    showPopup = false;
    suggestions = [];

    // Restore focus and cursor position
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        const newPos = mentionStart + mentionText.length + 1;
        textarea.setSelectionRange(newPos, newPos);
      }
    });
  }
</script>

{#if showPopup && suggestions.length > 0}
  <div class="absolute left-4 right-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto"
       style="bottom: calc(100% - {textarea ? textarea.offsetTop + 24 : 0}px)">
    {#each suggestions as suggestion, i}
      <button
        class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors {i === selectedIndex ? 'bg-[var(--color-surface-hover)]' : ''}"
        onmousedown={(e) => { e.preventDefault(); selectSuggestion(suggestion); }}
      >
        <div class="flex-1 min-w-0">
          <span class="text-sm font-medium">{suggestion.identityName ?? '?'}</span>
          <div class="flex items-center gap-3 mt-0.5">
            {#if suggestion.handles.bluesky}
              <span class="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-bluesky)]"></span>
                {suggestion.handles.bluesky}
              </span>
            {/if}
            {#if suggestion.handles.mastodon}
              <span class="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-mastodon)]"></span>
                {suggestion.handles.mastodon}
              </span>
            {/if}
          </div>
        </div>
      </button>
    {/each}
  </div>
{/if}
