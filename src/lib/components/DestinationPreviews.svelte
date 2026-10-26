<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import type { Account } from '$lib/types';
  import { resolveMentionsForPlatform } from '$lib/compose/mentions';
  import { splitForPlatform, type ThreadPlan } from '$lib/compose/thread';
  import type { ThreadGate } from '$lib/compose/adapter';
  let { accounts, selected, sharedText, overrides = $bindable({}), mediaPreviews = [], mediaTypes = [], altTexts = [], threadsMediaUrl = '', visibility, contentWarning, threadGate, disableQuotes, selfLabel }: {
    accounts: Account[]; selected: number[]; sharedText: string; overrides: Record<string, string>;
    mediaPreviews?: string[]; mediaTypes?: string[]; altTexts?: string[]; threadsMediaUrl?: string; visibility: string; contentWarning: string;
    threadGate: ThreadGate; disableQuotes: boolean; selfLabel: string;
  } = $props();
  let plans: Record<string, ThreadPlan> = $state({});
  let previewError = $state('');
  $effect(() => {
    const destinations = accounts.filter(a => selected.includes(a.id));
    const inputs = destinations.map(a => ({ account: a, text: overrides[String(a.id)] ?? sharedText }));
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const values = await Promise.all(inputs.map(async ({ account, text }) => [String(account.id), splitForPlatform(await resolveMentionsForPlatform(text, account.platform), account.platform)] as const));
        if (active) { plans = Object.fromEntries(values); previewError = ''; }
      } catch (e) { if (active) previewError = String(e); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  });
</script>

<div class="space-y-3">
  <h2 class="text-sm font-semibold">{i18n.t.compose.preview}</h2>
  {#if previewError}<p role="alert" class="text-sm text-red-400">{previewError}</p>{/if}
  {#each accounts.filter(a => selected.includes(a.id)) as account (account.id)}
    <section class="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2" aria-label={`${i18n.t.compose.preview} @${account.handle}`}>
      <div class="text-sm font-medium">@{account.handle} <span class="text-xs text-[var(--color-text-muted)]">· {account.platform}</span></div>
      <p class="text-xs text-[var(--color-text-muted)]">
        {account.platform !== 'mastodon' || visibility === 'public' ? i18n.t.compose.public : visibility === 'private' ? i18n.t.compose.followersOnlyVis : visibility === 'unlisted' ? i18n.t.compose.unlisted : i18n.t.compose.direct}
        {#if account.platform === 'bluesky'}
          · {threadGate === 'nobody' ? i18n.t.workflow.nobodyReplies : threadGate === 'following' ? i18n.t.workflow.followingReplies : threadGate === 'mentioned' ? i18n.t.workflow.mentionedReplies : i18n.t.workflow.allReplies}
          {#if disableQuotes} · {i18n.t.compose.disableQuoting}{/if}
          {#if selfLabel !== 'none'} · {selfLabel}{/if}
        {/if}
      </p>
      {#if account.platform === 'mastodon' && contentWarning}<p class="text-xs">{i18n.t.post.contentWarning}: {contentWarning}</p>{/if}
      {#if account.platform === 'threads' && mediaPreviews.length && !threadsMediaUrl.trim()}<p class="text-xs text-[var(--color-text-muted)]">{i18n.t.workflow.threadsMediaHint}</p>{/if}
      <div class="grid grid-cols-2 gap-1">
        {#each account.platform === 'threads' ? (threadsMediaUrl.trim() ? [threadsMediaUrl.trim()] : []) : mediaPreviews as url, index}
          {#if account.platform === 'threads' ? /\.(mp4|mov|webm)(?:[?#]|$)/i.test(url) : mediaTypes[index]?.startsWith('video/')}
            <video src={url} controls class="rounded max-h-36 w-full"><track kind="captions" /></video>
          {:else}
            <img src={url} alt={altTexts[index] ?? ''} class="rounded max-h-36 w-full object-contain" />
          {/if}
          <span class="text-xs text-[var(--color-text-muted)]">{altTexts[index] || i18n.t.compose.altTextPlaceholder}</span>
        {/each}
      </div>
      {#each plans[String(account.id)]?.parts ?? [] as part}
        <div class="text-sm whitespace-pre-wrap break-words border-t border-[var(--color-border)] pt-2">{part.text}<span class="text-[10px] text-[var(--color-text-muted)] ml-2">{part.charCount}/{part.charLimit}</span></div>
      {/each}
      <details>
        <summary class="text-xs cursor-pointer text-[var(--color-primary-text)]">{i18n.t.workflow.destinationText}</summary>
        <p class="text-xs text-[var(--color-text-muted)] my-2">{i18n.t.workflow.overrideHint}</p>
        <label class="block text-xs space-y-1">
          <span>{i18n.t.workflow.destinationText} · @{account.handle}</span>
          <textarea value={overrides[String(account.id)] ?? sharedText} oninput={e => overrides = { ...overrides, [String(account.id)]: e.currentTarget.value }} class="w-full p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] min-h-24"></textarea>
        </label>
        {#if String(account.id) in overrides}
          <button class="text-xs underline" onclick={() => { const next = { ...overrides }; delete next[String(account.id)]; overrides = next; }}>{i18n.t.workflow.sharedText}</button>
        {/if}
      </details>
    </section>
  {/each}
  {#if visibility !== 'public' && accounts.some(a => selected.includes(a.id) && a.platform !== 'mastodon')}
    <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.workflow.publicNotice}</p>
  {/if}
</div>
