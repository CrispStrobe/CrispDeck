import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { Account } from '$lib/types';
import type { ComposerSnapshot } from '$lib/publishing/snapshots';

const boundaries = vi.hoisted(() => ({ initAllClients: vi.fn(), writes: new Set<Promise<void>>() }));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: boundaries.initAllClients }));
vi.mock('$lib/archive', () => ({ searchArchive: async () => [] }));
vi.mock('$lib/compose/mentions', () => ({ resolveMentionsForPlatform: async (text: string) => text, searchMentions: async () => [] }));
vi.mock('$lib/voice-commands', () => ({ tryVoiceCommand: () => false, looksLikeCommand: () => false }));
vi.mock('$lib/publishing/snapshots', async importOriginal => {
  const actual = await importOriginal<typeof import('$lib/publishing/snapshots')>();
  // Retain actual IndexedDB persistence; track commits so unmount/reload tests
  // wait for the real queued save rather than a fixed timeout.
  function tracked(write: Promise<void>): Promise<void> {
    boundaries.writes.add(write);
    void write.finally(() => boundaries.writes.delete(write));
    return write;
  }
  return { ...actual,
    saveSnapshot: (saved: ComposerSnapshot) => tracked(actual.saveSnapshot(saved)),
    deleteSnapshot: (id: string) => tracked(actual.deleteSnapshot(id)),
  };
});

import ComposePage from './+page.svelte';
import { snapshot, loadSnapshot, deleteSnapshot } from '$lib/publishing/snapshots';
import { persistDraft, draftSnapshot, removeDraft } from '$lib/publishing/drafts';
import { listDrafts } from '$lib/db';

const accounts = [
  { id: 1, platform: 'threads', handle: 'writer.threads' },
  { id: 2, platform: 'mastodon', handle: 'writer@social.example' },
  { id: 3, platform: 'bluesky', handle: 'writer.bsky.social' },
] as Account[];
let instance: ReturnType<typeof mount> | undefined;

async function flushWrites() {
  // A destroy-triggered save first waits on the composer's previous write.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  while (boundaries.writes.size) {
    await Promise.all([...boundaries.writes]);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
}
async function leave() {
  if (instance) await unmount(instance);
  instance = undefined;
  await flushWrites();
  document.body.innerHTML = '';
}
async function render() {
  const target = document.createElement('div'); document.body.append(target);
  instance = mount(ComposePage, { target }); flushSync();
  await vi.waitFor(() => {
    flushSync();
    expect(target.querySelector('textarea[rows="8"]')).not.toBeNull();
    expect(target.querySelector('fieldset')?.disabled).toBe(false);
  });
  return target;
}
function input(target: HTMLElement, selector: string, value: string) {
  const field = target.querySelector<HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing field ${selector}`);
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
async function saveDraft(target: HTMLElement) {
  const button = [...target.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Save Draft');
  expect(button?.disabled).toBe(false);
  button!.click(); flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('fieldset')?.disabled).toBe(false); });
  await flushWrites();
}

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  window.history.replaceState({}, '', '/compose');
  boundaries.initAllClients.mockResolvedValue({ accounts, clients: new Map() });
  await deleteSnapshot('autosave');
  for (const draft of await listDrafts()) await removeDraft(draft);
});
afterEach(leave);

describe('full composer durable content', () => {
  it('autosaves and restores Threads URLs when shared text and local media are empty', async () => {
    const target = await render();
    const urls = ['https://media.example/one.png', 'https://media.example/two.png'];
    input(target, 'textarea[placeholder="https://"]', urls.join('\n'));
    await leave();
    expect(await loadSnapshot('autosave')).toMatchObject({ text: '', media: [], options: { mediaUrls: urls } });
    const restored = await render();
    expect(restored.querySelector<HTMLTextAreaElement>('textarea[rows="8"]')?.value).toBe('');
    expect(restored.querySelector<HTMLTextAreaElement>('textarea[placeholder="https://"]')?.value).toBe(urls.join('\n'));
    expect(restored.querySelectorAll('section[aria-label="Preview @writer.threads"] img')).toHaveLength(2);
  });

  it('autosaves and restores destination-specific text with an empty shared editor', async () => {
    const target = await render();
    input(target, 'section[aria-label="Preview @writer.bsky.social"] textarea', 'A Bluesky-only draft');
    await leave();
    expect(await loadSnapshot('autosave')).toMatchObject({ text: '', media: [], overrides: { '3': 'A Bluesky-only draft' } });
    const restored = await render();
    expect(restored.querySelector<HTMLTextAreaElement>('textarea[rows="8"]')?.value).toBe('');
    expect(restored.querySelector<HTMLTextAreaElement>('section[aria-label="Preview @writer.bsky.social"] textarea')?.value).toBe('A Bluesky-only draft');
  });

  it.each([
    { accountId: 2, replyTo: { platform: 'mastodon' as const, uri: 'https://remote.example/users/alice/statuses/remote-456', id: 'local-987' } },
    { accountId: 3, replyTo: { platform: 'bluesky' as const, uri: 'at://did:plc:alice/app.bsky.feed.post/parent', cid: 'parent-cid', rootUri: 'at://did:plc:alice/app.bsky.feed.post/root', rootCid: 'root-cid' } },
  ])('preserves complete $replyTo.platform reply metadata when reopening and saving a draft', async ({ accountId, replyTo }) => {
    const id = await persistDraft(snapshot('floating-compose', 'An unfinished reply', [accountId], {}, { replyTo }));
    window.history.replaceState({}, '', `/compose?draft=${id}`);
    const target = await render();
    input(target, 'textarea[rows="8"]', 'The completed reply');
    await saveDraft(target);
    const draft = (await listDrafts()).find(value => value.id === id)!;
    const saved = await draftSnapshot(draft);
    expect(saved.text).toBe('The completed reply');
    expect(saved.options.replyTo).toEqual(replyTo);
    await leave();
    expect((await loadSnapshot('autosave'))?.options.replyTo).toEqual(replyTo);
  });

  it('retains and displays a quote link without Bluesky quote URI/CID metadata', async () => {
    const quoteUrl = 'https://remote.example/@alice/456';
    const initial = { ...snapshot('floating-compose', 'My comment on this post', [2], {}, { quoteUrl }), context: { quoteAuthor: 'alice@remote.example', quoteText: 'The quoted post', replyAuthor: '' } };
    const id = await persistDraft(initial);
    window.history.replaceState({}, '', `/compose?draft=${id}`);
    const target = await render();
    expect(target.textContent).toContain('Quoting');
    expect(target.textContent).toContain('@alice@remote.example');
    expect(target.textContent).toContain('The quoted post');
    await saveDraft(target);
    const saved = await draftSnapshot((await listDrafts()).find(value => value.id === id)!);
    expect(saved.options.quoteUrl).toBe(quoteUrl);
    expect(saved.options.quoteUri).toBeUndefined();
    expect(saved.options.quoteCid).toBeUndefined();
    await leave();
    expect((await loadSnapshot('autosave'))?.options.quoteUrl).toBe(quoteUrl);
  });
});
