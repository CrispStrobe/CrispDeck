<!--
  Tag groups — self-contained, persisted by $lib/tag-groups.
-->
<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { Plus, Trash2 } from '@lucide/svelte';
  import { listTagGroups, saveTagGroup, deleteTagGroup, type TagGroup } from '$lib/tag-groups';

  let tagGroups: TagGroup[] = $state(listTagGroups());
  let newGroupName = $state('');
  let newGroupTags = $state('');
</script>

<!-- Tag Groups -->
<section class="mb-8">
  <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.tagGroupsTitle}</h2>
  <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.tagGroupsHint}</p>

    {#if tagGroups.length > 0}
      <div class="space-y-2">
        {#each tagGroups as group}
          <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md">
            <div>
              <span class="text-sm font-medium">{group.name}</span>
              <span class="text-[10px] text-[var(--color-text-muted)] ml-2">{group.tags.map(t => `#${t}`).join(' ')}</span>
            </div>
            <button
              onclick={() => { deleteTagGroup(group.id); tagGroups = listTagGroups(); }}
              class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1"
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
        bind:value={newGroupName}
        placeholder="Group name"
        class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
      />
      <input
        type="text"
        bind:value={newGroupTags}
        placeholder="tag1, tag2, tag3"
        class="flex-2 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
      />
      <button
        onclick={() => {
          if (newGroupName.trim() && newGroupTags.trim()) {
            saveTagGroup({ name: newGroupName.trim(), tags: newGroupTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) });
            tagGroups = listTagGroups();
            newGroupName = '';
            newGroupTags = '';
          }
        }}
        disabled={!newGroupName.trim() || !newGroupTags.trim()}
        class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
      >
        <Plus size={12} />
      </button>
    </div>
  </div>
</section>
