<script lang="ts">
  import { ImageIcon, MessageSquareOff, Heart, Repeat } from '@lucide/svelte';
  import type { Filters } from '$lib/types';

  let { filters, onchange }: {
    filters: Filters;
    onchange: (newFilters: Partial<Filters>) => void;
  } = $props();
</script>

<div class="bg-[var(--color-surface)] rounded-lg p-4 mb-4 border border-[var(--color-border)] sticky top-0 z-10">
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
    <input
      type="text"
      placeholder="Search in posts..."
      value={filters.searchTerm}
      oninput={(e) => onchange({ searchTerm: (e.target as HTMLInputElement).value })}
      class="lg:col-span-2 w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
    />

    <select
      value={filters.sortBy}
      onchange={(e) => onchange({ sortBy: (e.target as HTMLSelectElement).value as Filters['sortBy'] })}
      class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
    >
      <option value="newest">Sort: Newest</option>
      <option value="oldest">Sort: Oldest</option>
      <option value="likes">Sort: Most Liked</option>
      <option value="reposts">Sort: Most Reposted</option>
      <option value="engagement">Sort: Top Engagement</option>
    </select>

    <div class="relative">
      <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Heart size={14} class="text-[var(--color-text-muted)]" />
      </div>
      <input
        type="number"
        placeholder="Min Likes"
        min="0"
        value={filters.minLikes || ''}
        oninput={(e) => onchange({ minLikes: parseInt((e.target as HTMLInputElement).value) || 0 })}
        class="w-full pl-9 pr-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
      />
    </div>
  </div>

  <div class="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center gap-5 flex-wrap">
    <label class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
      <input type="checkbox" checked={filters.hasMedia} onchange={(e) => onchange({ hasMedia: (e.target as HTMLInputElement).checked })} class="rounded" />
      <ImageIcon size={14} />
      <span>Has Media</span>
    </label>
    <label class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
      <input type="checkbox" checked={filters.hideReplies} onchange={(e) => onchange({ hideReplies: (e.target as HTMLInputElement).checked })} class="rounded" />
      <MessageSquareOff size={14} />
      <span>Hide Replies</span>
    </label>
    <label class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
      <input type="checkbox" checked={filters.hideReposts} onchange={(e) => onchange({ hideReposts: (e.target as HTMLInputElement).checked })} class="rounded" />
      <Repeat size={14} />
      <span>Hide Reposts</span>
    </label>
  </div>
</div>
