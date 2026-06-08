<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listReadingLists, createReadingList, saveReadingList,
    deleteReadingList, removePostFromList, type ReadingList,
  } from '$lib/reading-lists';
  import { i18n } from '$lib/i18n.svelte';
  import { BookOpen, Plus, Trash2, X, Loader2 } from '@lucide/svelte';

  let lists: ReadingList[] = $state([]);
  let showNewForm = $state(false);
  let newName = $state('');
  let newDesc = $state('');
  let selectedListId: string | null = $state(null);

  onMount(() => { lists = listReadingLists(); });

  function handleCreate() {
    if (!newName.trim()) return;
    const list = createReadingList(newName.trim(), newDesc.trim());
    saveReadingList(list);
    lists = listReadingLists();
    newName = '';
    newDesc = '';
    showNewForm = false;
  }

  function handleDelete(id: string) {
    deleteReadingList(id);
    lists = listReadingLists();
    if (selectedListId === id) selectedListId = null;
  }

  function handleRemovePost(listId: string, postUri: string) {
    removePostFromList(listId, postUri);
    lists = listReadingLists();
  }

  const selectedList = $derived(lists.find(l => l.id === selectedListId));
</script>

<svelte:head><title>CrispDeck — {i18n.t.nav.readingLists}</title></svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <!-- Bookmarks tabs -->
  <div class="flex items-center gap-1 mb-4">
    <a href="/bookmarks" class="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Bookmarks</a>
    <a href="/reading-lists" class="px-4 py-2 text-sm font-medium border-b-2 border-[var(--color-primary)] text-[var(--color-text)]">Reading Lists</a>
  </div>

  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <BookOpen size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.nav.readingLists}</h1>
      {#if lists.length > 0}
        <span class="text-sm text-[var(--color-text-muted)]">({lists.length})</span>
      {/if}
    </div>
    <button
      onclick={() => showNewForm = !showNewForm}
      class="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--color-primary)] rounded-md hover:opacity-90"
    >
      <Plus size={14} />
      {i18n.t.readingLists.newList}
    </button>
  </div>

  {#if showNewForm}
    <div class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] space-y-3">
      <input
        type="text"
        bind:value={newName}
        placeholder={i18n.t.readingLists.namePlaceholder}
        class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
        onkeydown={(e) => e.key === 'Enter' && handleCreate()}
      />
      <input
        type="text"
        bind:value={newDesc}
        placeholder={i18n.t.readingLists.descPlaceholder}
        class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none"
      />
      <div class="flex gap-2">
        <button onclick={handleCreate} disabled={!newName.trim()} class="px-4 py-2 text-sm bg-[var(--color-primary)] rounded-md disabled:opacity-50">{i18n.t.readingLists.create}</button>
        <button onclick={() => showNewForm = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">{i18n.t.settings.cancel}</button>
      </div>
    </div>
  {/if}

  {#if lists.length === 0}
    <div class="text-center py-20 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <BookOpen size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">{i18n.t.readingLists.empty}</h3>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.readingLists.emptyHint}</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- List sidebar -->
      <div class="space-y-2">
        {#each lists as list}
          <div
            role="button"
            tabindex="0"
            onclick={() => selectedListId = selectedListId === list.id ? null : list.id}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedListId = selectedListId === list.id ? null : list.id; } }}
            class="w-full text-left p-3 bg-[var(--color-surface)] rounded-lg border transition-colors cursor-pointer {selectedListId === list.id ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}"
          >
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <span class="text-sm font-medium">{list.name}</span>
                <span class="text-[10px] text-[var(--color-text-muted)] ml-2">{list.posts.length} posts</span>
              </div>
              <button
                onclick={(e) => { e.stopPropagation(); handleDelete(list.id); }}
                class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {#if list.description}
              <p class="text-[10px] text-[var(--color-text-muted)] mt-1 truncate">{list.description}</p>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Selected list contents -->
      <div>
        {#if selectedList}
          <h3 class="text-sm font-semibold mb-3">{selectedList.name}</h3>
          {#if selectedList.posts.length === 0}
            <p class="text-sm text-[var(--color-text-muted)] p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
              {i18n.t.readingLists.listEmpty}
            </p>
          {:else}
            <div class="space-y-2">
              {#each selectedList.posts as post}
                <div class="p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5 mb-1">
                        <span class="w-2 h-2 rounded-full" style="background: var(--color-{post.platform})"></span>
                        <span class="text-xs font-medium">{post.authorName}</span>
                        <span class="text-[10px] text-[var(--color-text-muted)]">@{post.authorHandle}</span>
                      </div>
                      <p class="text-xs text-[var(--color-text)]">{post.text}</p>
                      <p class="text-[9px] text-[var(--color-text-muted)] mt-1">{new Date(post.addedAt).toLocaleDateString()}</p>
                    </div>
                    <button
                      onclick={() => handleRemovePost(selectedList!.id, post.uri)}
                      class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] flex-shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="text-sm text-[var(--color-text-muted)] p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            {i18n.t.readingLists.selectHint}
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>
