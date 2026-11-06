<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { requiresQuery } from '$lib/deck-columns';
  import type { DeckColumnConfig } from '$lib/deck-layouts';
  import type { DeckColumnFilters } from '$lib/deck-filters';
  import type { Account } from '$lib/types';
  import type { ClientEntry } from '$lib/api/client-factory';
  import type { BlueskyClient } from '$lib/api/bluesky';
  import type { MastodonClient } from '$lib/api/mastodon';
  import { swallow } from '$lib/debug-log';

  let { column, accounts, clients, onsave, onclose }: {
    column: DeckColumnConfig;
    accounts: Account[];
    clients: Map<number, ClientEntry>;
    onsave: (column: DeckColumnConfig) => void;
    onclose: () => void;
  } = $props();
  let draft = $state<DeckColumnConfig>(untrack(() => structuredClone($state.snapshot(column))));
  let filters = $state<DeckColumnFilters>(untrack(() => ({ ...column.filters })));
  let muteText = $state(untrack(() => column.muteWords?.join('\n') ?? ''));
  let error = $state('');
  let listError = $state(false);
  let listLoading = $state(false);
  let dialog: HTMLDialogElement;
  let listChoices = $state<{ key: string; accountId: number; platform: Account['platform']; uri: string; title: string }[]>([]);
  const publishingColumn = $derived(draft.type === 'drafts' || draft.type === 'scheduled');
  const notificationTypes = ['like', 'repost', 'follow', 'mention', 'reply', 'quote', 'follow_request'] as const;

  onMount(() => {
    const previous = document.activeElement;
    dialog.showModal();
    let active = true;
    if (column.type === 'list') {
      listLoading = true;
      Promise.allSettled(accounts.filter(a => a.platform !== 'threads').map(async account => {
        const entry = clients.get(account.id);
        if (!entry) return [];
        if (account.platform === 'mastodon') {
          const lists = await (entry.client as MastodonClient).getLists();
          return lists.map(list => ({ key: `${account.id}:${list.id}`, accountId: account.id, platform: account.platform, uri: list.id, title: `${list.title} · @${account.handle}` }));
        }
        const response = entry.oauthAgent
          ? (await entry.oauthAgent.api.app.bsky.graph.getLists({ actor: account.did ?? account.handle, limit: 100 })).data
          : await (entry.client as BlueskyClient).getLists(account.did ?? account.handle);
        return response.lists.map(list => ({ key: `${account.id}:${list.uri}`, accountId: account.id, platform: account.platform, uri: list.uri, title: `${list.name} · @${account.handle}` }));
      })).then(results => {
        if (!active) return;
        listChoices = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        listError = results.some(result => result.status === 'rejected');
        for (const result of results) if (result.status === 'rejected') swallow('deck.listPicker', result.reason);
        listLoading = false;
      });
    }
    return () => { active = false; if (previous instanceof HTMLElement) previous.focus(); };
  });

  function toggleAccount(id: number, checked: boolean) {
    const ids = draft.accountIds ?? accounts.map(account => account.id);
    draft.accountIds = checked ? [...new Set([...ids, id])] : ids.filter(value => value !== id);
  }

  function save() {
    if (!draft.title.trim()) { error = i18n.t.deck.columnTitleRequired; return; }
    const query = draft.query?.trim().replace(draft.type === 'hashtag' ? /^#+/ : /$^/, '');
    if (requiresQuery(draft.type) && !query) { error = i18n.t.deck.queryRequired; return; }
    if (draft.type === 'tag-group' && !query?.split(',').some(tag => tag.trim().replace(/^#+/, ''))) { error = i18n.t.deck.queryRequired; return; }
    if (draft.type === 'rss') {
      try {
        const url = new URL(draft.query!);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('url');
      } catch { error = i18n.t.deck.invalidRssUrl; return; }
    }
    onsave({ ...$state.snapshot(draft), title: draft.title.trim(), query, filters: $state.snapshot(filters), muteWords: muteText.split('\n').map(word => word.trim()).filter(Boolean) });
  }
</script>

<dialog bind:this={dialog} onclose={onclose} aria-labelledby="column-settings-title" class="m-auto max-h-[90svh] w-[min(42rem,95vw)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-0 text-[var(--color-text)] shadow-xl backdrop:bg-black/60">
  <form onsubmit={(event) => { event.preventDefault(); save(); }} class="p-5 space-y-4">
    <h2 id="column-settings-title" class="text-lg font-semibold">{i18n.t.deck.columnSettings}</h2>
    <label class="block text-sm">{i18n.t.deck.columnTitle}<input class="field" bind:value={draft.title} maxlength="200" required /></label>
    {#if draft.type === 'list'}
      <label class="block text-sm">{i18n.t.nav.lists}
        <select class="field" disabled={listLoading} value="" onchange={(event) => { const choice = listChoices.find(list => list.key === event.currentTarget.value); if (choice) { draft.query = choice.uri; draft.accountIds = [choice.accountId]; draft.platform = choice.platform; draft.title = choice.title.slice(0, 200); } }}>
          <option value="">{listLoading ? i18n.t.common.loading : i18n.t.deck.chooseList}</option>
          {#each listChoices as list}<option value={list.key}>{list.title}</option>{/each}
        </select>
      </label>
      {#if listError}<p role="status" class="text-sm text-amber-500">{i18n.t.deck.listLoadFailed}</p>{/if}
    {/if}
    {#if requiresQuery(draft.type)}
      <label class="block text-sm">{i18n.t.deck.columnQuery}<input class="field" bind:value={draft.query} maxlength="2000" required /></label>
    {/if}
    {#if draft.type !== 'rss'}
      <fieldset class="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
        <legend class="px-1 text-sm font-medium">{i18n.t.deck.columnAccounts}</legend>
        <label class="flex gap-2 text-sm"><input type="checkbox" checked={draft.accountIds === undefined} onchange={(event) => draft.accountIds = event.currentTarget.checked ? undefined : []} />{i18n.t.deck.allAccounts}</label>
        {#each accounts as account}
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.accountIds === undefined || draft.accountIds.includes(account.id)} onchange={(event) => toggleAccount(account.id, event.currentTarget.checked)} />
            {#if account.avatar_url}<img src={account.avatar_url} alt="" class="w-5 h-5 rounded-full" />{/if}
            <span>@{account.handle} <span class="text-[var(--color-text-muted)]">({account.platform})</span></span>
          </label>
        {/each}
        {#if draft.accountIds?.length === 0}<p class="text-sm text-amber-500">{i18n.t.deck.noSelectedAccounts}</p>{/if}
        <label class="block text-sm">{i18n.t.archive.byPlatform}<select class="field" value={draft.platform ?? 'all'} onchange={(event) => draft.platform = event.currentTarget.value}>
          <option value="all">{i18n.t.archive.allPlatforms}</option><option value="bluesky">Bluesky</option><option value="mastodon">Mastodon</option><option value="threads">Threads</option>
        </select></label>
      </fieldset>
    {/if}
    <fieldset class="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
      <legend class="px-1 text-sm font-medium">{i18n.t.deck.columnFilters}</legend>
      <label class="block text-sm">{i18n.t.deck.includeText}<input class="field" bind:value={filters.searchTerm} /></label>
      {#if !publishingColumn}
      <label class="block text-sm">{i18n.t.deck.excludeText}<input class="field" bind:value={filters.excludeText} /></label>
      <label class="block text-sm">{i18n.t.deck.authorFilter}<input class="field" bind:value={filters.author} /></label>
      {#if ['notifications', 'activity', 'followers'].includes(draft.type)}
        <fieldset class="space-y-2"><legend class="text-sm font-medium">{i18n.t.deck.notificationTypes}</legend>
          {#each notificationTypes as type}
            <label class="flex gap-2 text-sm"><input type="checkbox" checked={!filters.notificationTypes || filters.notificationTypes.includes(type)} onchange={(event) => { const selected = filters.notificationTypes ?? [...notificationTypes]; filters.notificationTypes = event.currentTarget.checked ? [...selected, type] : selected.filter(value => value !== type); }} />{i18n.t.deck.notificationTypeLabels[type]}</label>
          {/each}
        </fieldset>
      {:else}
        <label class="block text-sm">{i18n.t.deck.languageFilter}<input class="field" bind:value={filters.language} maxlength="35" placeholder="en" /></label>
        <div class="flex flex-wrap gap-3 text-sm">
          <label class="flex gap-2"><input type="checkbox" bind:checked={filters.hasMedia} />{i18n.t.feed.hasMedia}</label>
          <label class="flex gap-2"><input type="checkbox" bind:checked={filters.hideReplies} />{i18n.t.feed.hideReplies}</label>
          <label class="flex gap-2"><input type="checkbox" bind:checked={filters.hideReposts} />{i18n.t.feed.hideReposts}</label>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm">{i18n.t.feed.minLikes}<input class="field" type="number" min="0" max="1000000000" bind:value={filters.minLikes} /></label>
          <label class="text-sm">{i18n.t.deck.minReposts}<input class="field" type="number" min="0" max="1000000000" bind:value={filters.minReposts} /></label>
        </div>
      {/if}
      <label class="block text-sm">{i18n.t.deck.localMuteWords}<textarea class="field" rows="3" bind:value={muteText}></textarea></label>
      <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.deck.muteWordsHint}</p>
      {/if}
      <button type="button" onclick={() => { filters = {}; muteText = ''; }} class="text-sm text-[var(--color-primary-text)]">{i18n.t.deck.resetFilters}</button>
    </fieldset>
    {#if !publishingColumn}
    <label class="block text-sm">{i18n.t.deck.refreshEvery}<select class="field" value={draft.refreshIntervalSeconds ?? 300} onchange={(event) => draft.refreshIntervalSeconds = Number(event.currentTarget.value)}>
      {#each [30, 60, 120, 300, 600] as seconds}<option value={seconds}>{i18n.t.deck.seconds.replace('{count}', String(seconds))}</option>{/each}
    </select></label>
    {/if}
    {#if error}<p role="alert" class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      <button type="button" onclick={() => dialog.close()} class="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">{i18n.t.common.cancel}</button>
      <button type="submit" class="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm text-white">{i18n.t.deck.save}</button>
    </div>
  </form>
</dialog>

<style>
  .field { display: block; width: 100%; margin-top: .35rem; padding: .5rem .65rem; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: .375rem; }
</style>
