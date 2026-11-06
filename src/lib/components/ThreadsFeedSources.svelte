<script lang="ts">
  import { untrack } from 'svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { getThreadsSources, saveThreadsSources, parseProfiles, parseKeywords, importThreadsProfiles } from '$lib/threads-feed';
  let { account }: { account: string } = $props();
  const initial = untrack(() => getThreadsSources(account));
  let profiles = $state(initial.profiles.join('\n'));
  let keywords = $state(initial.keywords.join('\n'));
  let message = $state('');
  function save() {
    const parsedProfiles = parseProfiles(profiles);
    const parsedKeywords = parseKeywords(keywords);
    if (parsedProfiles.length > 50 || parsedKeywords.length > 10) { message = 'Use at most 50 profiles and 10 keywords.'; return; }
    if (!saveThreadsSources(account, { profiles: parsedProfiles, keywords: parsedKeywords })) { message = 'Could not save feed sources.'; return; }
    profiles = parsedProfiles.join('\n'); keywords = parsedKeywords.join('\n');
    message = 'Saved. Refresh the feed to load these sources.';
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('File is too large (maximum 2 MB).');
      const imported = importThreadsProfiles(await file.text());
      profiles = [...new Set([...parseProfiles(profiles), ...imported])].join('\n');
      message = `Imported ${imported.length} usernames. Review and save the list.`;
    } catch (error) { message = error instanceof Error ? error.message : 'Could not import file.'; }
    input.value = '';
  }
</script>
<details class="mt-2 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
  <summary class="cursor-pointer text-sm font-medium">Threads feed sources for {account}</summary>
  <p class="text-xs text-[var(--color-text-muted)] mt-2">Your feed combines your posts, mentions, public profiles and keyword results. Threads does not provide your following list or home timeline through this API. Public-profile discovery and keyword search require Meta permissions; standard access restricts profiles to certain Meta accounts. Public profiles must have at least 100 followers. Meta limits profile discovery to 1,000 requests per day. Results are cached for two hours on this device.</p>
  <label class="block text-sm mt-3" for={'threads-profiles-' + account}>{i18n.t.settings.threadsFeedProfiles}</label>
  <textarea id={'threads-profiles-' + account} bind:value={profiles} rows="4" class="w-full mt-1 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm"></textarea>
  <label class="block text-sm mt-2">Import following list (Meta JSON export)
    <input type="file" accept="application/json,.json" onchange={importFile} class="block mt-1 text-xs" />
  </label>
  <label class="block text-sm mt-3" for={'threads-keywords-' + account}>{i18n.t.settings.threadsFeedKeywords}</label>
  <textarea id={'threads-keywords-' + account} bind:value={keywords} rows="3" class="w-full mt-1 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm"></textarea>
  <button onclick={save} class="mt-2 px-3 py-1.5 bg-[var(--color-primary)] rounded-md text-sm">{i18n.t.settings.threadsFeedSave}</button>
  {#if message}<p role="status" class="text-sm mt-2">{message}</p>{/if}
</details>
