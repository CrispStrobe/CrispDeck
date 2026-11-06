import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ColumnSettings from './ColumnSettings.svelte';
import { columnAccounts } from '$lib/deck-accounts';
import { i18n } from '$lib/i18n.svelte';
import type { DeckColumnConfig } from '$lib/deck-layouts';
import type { Account } from '$lib/types';
import type { ClientEntry } from '$lib/api/client-factory';

let instance: ReturnType<typeof mount> | undefined;
const accounts = [
  { id: 1, platform: 'bluesky', handle: 'writer.bsky', did: 'did:plc:writer' },
  { id: 2, platform: 'mastodon', handle: 'writer@masto.test' },
] as Account[];

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(async () => {
  if (instance) await unmount(instance); instance = undefined;
  document.body.innerHTML = ''; vi.restoreAllMocks();
});

async function render(column: DeckColumnConfig) {
  const target = document.createElement('div'); document.body.appendChild(target);
  const clients = new Map([
    [1, { accountId: 1, platform: 'bluesky', client: { getLists: vi.fn().mockResolvedValue({ lists: [{ uri: 'at://did:plc:writer/app.bsky.graph.list/list', name: 'Bluesky list' }] }) } }],
    [2, { accountId: 2, platform: 'mastodon', client: { getLists: vi.fn().mockResolvedValue([{ id: '42', title: 'Mastodon list' }]) } }],
  ]) as unknown as Map<number, ClientEntry>;
  const onsave = vi.fn();
  instance = mount(ColumnSettings, { target, props: { column, accounts, clients, onsave, onclose: vi.fn() } });
  flushSync(); await tick(); await tick(); await tick();
  return { target, onsave };
}

function submit(target: ParentNode) {
  flushSync(() => target.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('column source settings', () => {
  it.each([
    ['bluesky', '2:42', 'mastodon', 2, '42'],
    ['mastodon', '1:at://did:plc:writer/app.bsky.graph.list/list', 'bluesky', 1, 'at://did:plc:writer/app.bsky.graph.list/list'],
  ] as const)('switches a %s list column to the chosen list’s platform and account', async (platform, choice, expectedPlatform, accountId, query) => {
    const { target, onsave } = await render({ id: 'list', title: 'List', type: 'list', query: platform === 'bluesky' ? 'at://did:plc:writer/app.bsky.graph.list/old' : '10', platform });
    const select = target.querySelector<HTMLSelectElement>('select')!;
    flushSync(() => { select.value = choice; select.dispatchEvent(new Event('change', { bubbles: true })); });
    submit(target);
    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ platform: expectedPlatform, query, accountIds: [accountId] }));
    expect(columnAccounts(onsave.mock.calls[0][0], accounts).map(account => account.id)).toEqual([accountId]);
  });

  it('does not turn an explicitly empty account selection into all accounts on save', async () => {
    const { target, onsave } = await render({ id: 'home', title: 'Home', type: 'timeline', accountIds: [] });
    expect(target.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
    submit(target);
    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ accountIds: [] }));
  });

  it.each(['#', '###'])('rejects a hashtag which normalizes to an empty query: %s', async query => {
    const { target, onsave } = await render({ id: 'tag', title: 'Tag', type: 'hashtag', query });
    submit(target);
    expect(onsave).not.toHaveBeenCalled();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(i18n.t.deck.queryRequired);
  });

  it('offers queue filters the local publishing renderer can actually apply', async () => {
    const { target } = await render({ id: 'drafts', title: 'Drafts', type: 'drafts' });
    expect(target.textContent).toContain(i18n.t.deck.includeText);
    expect(target.textContent).not.toContain(i18n.t.deck.excludeText);
    expect(target.textContent).not.toContain(i18n.t.feed.minLikes);
    expect(target.textContent).not.toContain(i18n.t.deck.refreshEvery);
  });
});
