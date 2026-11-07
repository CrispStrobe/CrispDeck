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
    if (parsedProfiles.length > 50 || parsedKeywords.length > 10) { message = i18n.t.settings.threadsSourcesLimit; return; }
    if (!saveThreadsSources(account, { profiles: parsedProfiles, keywords: parsedKeywords })) { message = i18n.t.settings.threadsSourcesSaveFailed; return; }
    profiles = parsedProfiles.join('\n'); keywords = parsedKeywords.join('\n');
    message = i18n.t.settings.threadsSourcesSaved;
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('File is too large (maximum 2 MB).');
      const imported = importThreadsProfiles(await file.text());
      profiles = [...new Set([...parseProfiles(profiles), ...imported])].join('\n');
      message = i18n.t.settings.threadsSourcesImported.replace('{count}', String(imported.length));
    } catch (error) { message = error instanceof Error ? ({ 'File is too large (maximum 2 MB).': i18n.t.settings.threadsSourcesTooLarge, 'Choose a JSON following export.': i18n.t.settings.threadsSourcesInvalidJson, 'No usernames found in this following export.': i18n.t.settings.threadsSourcesNoNames }[error.message] ?? i18n.t.settings.threadsSourcesImportFailed) : i18n.t.settings.threadsSourcesImportFailed; }
    input.value = '';
  }
</script>
<details class="mt-2 p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
  <summary class="cursor-pointer text-sm font-medium">{i18n.t.settings.threadsSourcesTitle.replace('{account}', account)}</summary>
  <p class="text-xs text-[var(--color-text-muted)] mt-2">{i18n.t.settings.threadsSourcesInfo}</p>
  <label class="block text-sm mt-3" for={'threads-profiles-' + account}>{i18n.t.settings.threadsFeedProfiles}</label>
  <textarea id={'threads-profiles-' + account} bind:value={profiles} rows="4" class="w-full mt-1 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm"></textarea>
  <label class="block text-sm mt-2">{i18n.t.settings.threadsSourcesImport}
    <input type="file" accept="application/json,.json" onchange={importFile} class="block mt-1 text-xs" />
  </label>
  <label class="block text-sm mt-3" for={'threads-keywords-' + account}>{i18n.t.settings.threadsFeedKeywords}</label>
  <textarea id={'threads-keywords-' + account} bind:value={keywords} rows="3" class="w-full mt-1 p-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm"></textarea>
  <button onclick={save} class="mt-2 px-3 py-1.5 bg-[var(--color-primary)] rounded-md text-sm">{i18n.t.settings.threadsFeedSave}</button>
  {#if message}<p role="status" class="text-sm mt-2">{message}</p>{/if}
</details>
