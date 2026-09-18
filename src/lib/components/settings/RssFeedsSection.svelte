<!--
  RSS feeds — self-contained, persisted by $lib/rss.
-->
<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { swallow } from '$lib/debug';
  import { Plus, Trash2 } from '@lucide/svelte';
  import { listFeeds, addFeed, removeFeed, importOPML, type RssFeed } from '$lib/rss';

  let rssFeeds: RssFeed[] = $state(listFeeds());
  let newFeedUrl = $state('');
</script>

<!-- RSS Feeds -->
<section class="mb-8">
  <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.rssFeedsTitle}</h2>
  <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.rssFeedsHint}</p>

    {#if rssFeeds.length > 0}
      <div class="space-y-2">
        {#each rssFeeds as feed}
          <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md">
            <div class="min-w-0">
              <span class="text-sm font-medium">{feed.title}</span>
              <span class="text-[10px] text-[var(--color-text-muted)] block truncate">{feed.url}</span>
            </div>
            <button
              onclick={() => { removeFeed(feed.id); rssFeeds = listFeeds(); }}
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
        type="url"
        bind:value={newFeedUrl}
        placeholder="https://example.com/feed.xml"
        class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
      />
      <button
        onclick={() => {
          if (newFeedUrl.trim()) {
            try { addFeed(newFeedUrl.trim()); rssFeeds = listFeeds(); newFeedUrl = ''; } catch (e) { swallow('settings.file', e); }
          }
        }}
        disabled={!newFeedUrl.trim()}
        class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
      >
        <Plus size={12} />
      </button>
    </div>

    <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
      <input
        type="file"
        accept=".opml,.xml"
        class="hidden"
        onchange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = () => {
              const imported = importOPML(reader.result as string);
              rssFeeds = listFeeds();
              alert(`Imported ${imported.length} feeds.`);
            };
            reader.readAsText(file);
          }
        }}
      />
      {i18n.t.settings.importOPML}
    </label>
  </div>
</section>
