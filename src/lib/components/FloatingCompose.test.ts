import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { Account, UnifiedPost } from '$lib/types';
import type { ComposerSnapshot } from '$lib/publishing/snapshots';
import type { PublishJob } from '$lib/publishing/outbox';

const mocks = vi.hoisted(() => ({
  initAllClients: vi.fn(), loadSnapshot: vi.fn(), saveSnapshot: vi.fn(), deleteSnapshot: vi.fn(),
  persistDraft: vi.fn(), createJob: vi.fn(), deliverJob: vi.fn(), getJob: vi.fn(), success: vi.fn(),
}));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: mocks.initAllClients }));
vi.mock('$lib/compose/mentions', () => ({ resolveMentionsForPlatform: async (text: string) => text }));
vi.mock('$lib/publishing/snapshots', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/publishing/snapshots')>(),
  loadSnapshot: mocks.loadSnapshot, saveSnapshot: mocks.saveSnapshot, deleteSnapshot: mocks.deleteSnapshot,
}));
vi.mock('$lib/publishing/drafts', () => ({ persistDraft: mocks.persistDraft }));
vi.mock('$lib/publishing/outbox', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/publishing/outbox')>(),
  createJob: mocks.createJob, deliverJob: mocks.deliverJob, getJob: mocks.getJob,
}));
vi.mock('$lib/toast.svelte', () => ({ toast: { success: mocks.success } }));

import FloatingCompose from './FloatingCompose.svelte';
import { snapshot } from '$lib/publishing/snapshots';
import { postContext } from '$lib/compose/context';

const accounts = [
  { id: 1, platform: 'bluesky', handle: 'primary.bsky.social', is_primary: true },
  { id: 2, platform: 'bluesky', handle: 'work.bsky.social' },
  { id: 3, platform: 'mastodon', handle: 'writer@social.example' },
] as Account[];
const post: UnifiedPost = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/123', text: 'An interesting post',
  author: { handle: 'alice.bsky.social', displayName: 'Alice' },
  platform: 'bluesky', sourceAccountId: 2, createdAt: '2026-01-01T00:00:00Z', isRepost: false,
  raw: { post: { cid: 'cid123', record: { reply: { root: { uri: 'at://did:plc:root/app.bsky.feed.post/root', cid: 'root-cid' } } } } },
};
let saved: ComposerSnapshot | undefined;
let job: PublishJob | undefined;
let instance: ReturnType<typeof createClassComponent> | undefined;

function pending(saved: ComposerSnapshot): PublishJob {
  return {
    id: 'job-1', snapshot: saved, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', status: 'failed',
    destinations: [{ accountId: 2, handle: 'work.bsky.social', platform: 'bluesky', parts: [{ text: saved.text, status: 'failed', error: 'Reconnect' }] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); saved = undefined; job = undefined;
  mocks.initAllClients.mockResolvedValue({ accounts, clients: new Map() });
  mocks.loadSnapshot.mockImplementation(async () => saved);
  mocks.saveSnapshot.mockImplementation(async value => { saved = value; });
  mocks.deleteSnapshot.mockImplementation(async () => { saved = undefined; });
  mocks.persistDraft.mockResolvedValue(42);
  mocks.getJob.mockImplementation(async () => job);
  mocks.createJob.mockImplementation(async (value: ComposerSnapshot) => { job = pending(value); return job; });
  mocks.deliverJob.mockImplementation(async () => {
    job = { ...job!, status: 'posted', destinations: job!.destinations.map(destination => ({ ...destination, parts: destination.parts.map(part => ({ ...part, status: 'posted' })) })) };
    return job;
  });
});

afterEach(async () => {
  instance?.$destroy(); instance = undefined;
  // Component destruction flushes its latest draft. Do not let that queued write
  // from one test overwrite the restored fixture of the next test.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  document.body.innerHTML = '';
});

async function render(props: Partial<{ open: boolean; replyToPost: UnifiedPost | null; quotePost: UnifiedPost | null }> = {}) {
  const target = document.createElement('div'); document.body.append(target);
  instance = createClassComponent({ component: FloatingCompose, target, props: { open: true, ...props } });
  flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('textarea')).not.toBeNull(); });
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('fieldset')?.disabled).toBe(false); });
  return target;
}
function button(target: HTMLElement, name: string): HTMLButtonElement {
  const found = [...target.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent?.trim().replace(/\s+/g, ' ')) === name);
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
function click(target: HTMLElement, name: string) { button(target, name).click(); flushSync(); }
function input(target: HTMLElement, selector: string, value: string) {
  const field = target.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing field: ${selector}`);
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
}
function attach(target: HTMLElement) {
  const file = new File(['photo bytes'], 'photo.png', { type: 'image/png', lastModified: 123 });
  attachFiles(target, [file]);
  return file;
}
function attachFiles(target: HTMLElement, files: File[]) {
  const field = target.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(field, 'files', { configurable: true, value: files });
  field.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
}

/** These mount the actual composer. Only storage and network boundaries are mocked. */
describe('floating composer drafts and scheduling', () => {
  it('saves a media-only draft with alt text and closes the panel without posting', async () => {
    const target = await render();
    const file = attach(target);
    input(target, 'input[placeholder*="Describe this image"]', 'The photo description');
    expect(button(target, 'Save Draft').disabled).toBe(false);
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    const value = mocks.persistDraft.mock.calls[0][0] as ComposerSnapshot;
    expect(value.text).toBe('');
    expect(value.media).toEqual([{ blob: file, name: 'photo.png', lastModified: 123 }]);
    expect(value.options.altTexts).toEqual(['The photo description']);
    expect(value.accountIds).toEqual([1, 2, 3]);
    expect(mocks.createJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(target.querySelector('[role=dialog]')).toBeNull());
  });

  it('preserves restored destinations, overrides, visibility, polls and Bluesky controls', async () => {
    saved = snapshot('floating-compose', 'A restored draft', [3, 2], { '2': 'Bluesky variation' }, {
      visibility: 'private', contentWarning: 'Spoiler', threadGate: 'mentioned', disableQuotes: true, selfLabel: 'graphic-media',
      poll: { options: ['Yes', 'No'], expiresIn: 3600, multiple: true },
    });
    const target = await render();
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    const value = mocks.persistDraft.mock.calls[0][0] as ComposerSnapshot;
    expect(value.accountIds).toEqual([3, 2]);
    expect(value.overrides).toEqual({ '2': 'Bluesky variation' });
    expect(value.options).toMatchObject({ visibility: 'private', contentWarning: 'Spoiler', threadGate: 'mentioned', disableQuotes: true, selfLabel: 'graphic-media', poll: { options: ['Yes', 'No'], expiresIn: 3600, multiple: true } });
  });

  it('schedules the complete draft locally and states the open-app limitation', async () => {
    const target = await render({ quotePost: post });
    input(target, 'textarea', 'Schedule this quote');
    const file = attach(target);
    input(target, 'input[placeholder*="Describe this image"]', 'Scheduled photo');
    click(target, 'Schedule');
    expect(target.textContent).toContain('Keep CrispDeck open');
    expect(target.textContent).toContain('Scheduling timezone');
    input(target, 'input[type=date]', '2099-12-01');
    input(target, 'input[type=time]', '14:30');
    click(target, 'Schedule Post');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    const [value, at] = mocks.persistDraft.mock.calls[0] as [ComposerSnapshot, string];
    expect(at).toBe(new Date('2099-12-01T14:30').toISOString());
    expect(value.text).toBe('Schedule this quote');
    expect(value.options).toMatchObject({ quoteUri: post.uri, quoteCid: 'cid123', quoteUrl: 'https://bsky.app/profile/alice.bsky.social/post/123', altTexts: ['Scheduled photo'] });
    expect(value.media[0].blob).toBe(file);
    expect(value.context).toEqual({ quoteAuthor: 'alice.bsky.social', quoteText: post.text, replyAuthor: '' });
    expect(mocks.createJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(target.querySelector('[role=dialog]')).toBeNull());
  });

  it('rejects a past schedule instead of turning it into an immediate post', async () => {
    const target = await render();
    input(target, 'textarea', 'For later'); click(target, 'Schedule');
    input(target, 'input[type=date]', '2000-01-01'); input(target, 'input[type=time]', '12:00');
    click(target, 'Schedule Post');
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Choose a date and time in the future');
    expect(mocks.persistDraft).not.toHaveBeenCalled(); expect(mocks.createJob).not.toHaveBeenCalled();
    expect(target.querySelector('textarea')?.value).toBe('For later');
  });

  it('keeps text and attachments when saving fails, and allows a real retry', async () => {
    const target = await render();
    input(target, 'textarea', 'Keep this draft'); const file = attach(target);
    mocks.persistDraft.mockRejectedValueOnce(new Error('Storage is full'));
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(target.querySelector('[role=alert]')?.textContent).toContain('Storage is full'));
    expect(target.querySelector('textarea')?.value).toBe('Keep this draft');
    expect(target.querySelector('img')).not.toBeNull();
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(2));
    expect(mocks.persistDraft.mock.calls[1][0].media[0].blob).toBe(file);
    await vi.waitFor(() => expect(target.querySelector('[role=dialog]')).toBeNull());
  });

  it('enforces required alt text for scheduled posts while still allowing unfinished drafts', async () => {
    localStorage.setItem('crispdeck-alt-text-mode', 'require');
    const target = await render(); attach(target); click(target, 'Schedule');
    input(target, 'input[type=date]', '2099-12-01'); input(target, 'input[type=time]', '14:30');
    click(target, 'Schedule Post');
    expect(target.querySelector('[role=alert]')?.textContent).toContain('Add alt text');
    expect(mocks.persistDraft).not.toHaveBeenCalled();
    expect(button(target, 'Save Draft').matches(':disabled')).toBe(false);
    await Promise.resolve();
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    expect(mocks.persistDraft.mock.calls[0][1]).toBeNull();
  });

  it('keeps all ten gallery images in the persisted draft', async () => {
    const target = await render({ quotePost: post });
    const files = Array.from({ length: 10 }, (_, index) => new File([`photo ${index}`], `${index}.png`, { type: 'image/png' }));
    attachFiles(target, files);
    expect(target.querySelectorAll('input[placeholder*="Describe this image"]')).toHaveLength(10);
    expect(target.textContent).toContain('Up to 10 attachments');
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    const value = mocks.persistDraft.mock.calls[0][0] as ComposerSnapshot;
    expect(value.media.map(item => item.blob)).toEqual(files);
    expect(value.options.altTexts).toHaveLength(10);
  });

  it('retains all images when changing to a destination with a smaller media limit', async () => {
    const target = await render({ quotePost: post });
    const files = Array.from({ length: 6 }, (_, index) => new File([`photo ${index}`], `${index}.png`, { type: 'image/png' }));
    attachFiles(target, files);
    const mastodon = [...target.querySelectorAll('button')].find(item => item.textContent?.includes('writer@social.example'))!;
    mastodon.click(); flushSync();
    expect(target.textContent).toContain('The selected accounts support up to 4 attachments');
    click(target, 'Post');
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(target.textContent).toContain('@writer@social.example: Mastodon supports up to 4 attachments');
    expect(target.querySelectorAll('input[placeholder*="Describe this image"]')).toHaveLength(6);
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    const value = mocks.persistDraft.mock.calls[0][0] as ComposerSnapshot;
    expect(value.accountIds).toEqual([2, 3]);
    expect(value.media.map(item => item.blob)).toEqual(files);
  });
});

describe('floating composer reply and delivery context', () => {
  it('uses the column source account and preserves a Bluesky reply root', async () => {
    const target = await render({ replyToPost: post });
    input(target, 'textarea', '@alice.bsky.social A response'); click(target, 'Post');
    await vi.waitFor(() => expect(mocks.createJob).toHaveBeenCalledTimes(1));
    const value = mocks.createJob.mock.calls[0][0] as ComposerSnapshot;
    expect(value.accountIds).toEqual([2]);
    expect(value.options.replyTo).toEqual({ uri: post.uri, platform: 'bluesky', cid: 'cid123', rootUri: 'at://did:plc:root/app.bsky.feed.post/root', rootCid: 'root-cid' });
    expect(value.context?.replyAuthor).toBe('alice.bsky.social');
  });

  it('reopens the same reply without replacing the text already written', async () => {
    const target = await render({ replyToPost: post });
    input(target, 'textarea', '@alice.bsky.social A carefully written response'); attach(target);
    click(target, 'Close');
    expect(target.querySelector('[role=dialog]')).toBeNull();
    instance!.$set({ open: true }); flushSync();
    await vi.waitFor(() => expect(target.querySelector('textarea')?.value).toBe('@alice.bsky.social A carefully written response'));
    expect(target.querySelector('img')).not.toBeNull();
    expect(mocks.persistDraft).not.toHaveBeenCalled();
  });

  it('preserves the old reply as a draft before switching to a different post', async () => {
    const target = await render({ replyToPost: post });
    input(target, 'textarea', '@alice.bsky.social Preserve this'); const file = attach(target);
    const other = { ...post, uri: 'at://did:plc:bob/app.bsky.feed.post/second', author: { handle: 'bob.bsky.social' }, sourceAccountId: 1 };
    instance!.$set({ replyToPost: other }); flushSync();
    await vi.waitFor(() => expect(target.querySelector('textarea')?.value).toBe('@bob.bsky.social '));
    expect(mocks.persistDraft).toHaveBeenCalledTimes(1);
    expect(mocks.persistDraft.mock.calls[0][0]).toMatchObject({ text: '@alice.bsky.social Preserve this', accountIds: [2], options: { replyTo: { uri: post.uri } } });
    expect(mocks.persistDraft.mock.calls[0][0].media[0].blob).toBe(file);
    expect(target.querySelector('img')).toBeNull();
    input(target, 'textarea', '@bob.bsky.social A new reply'); click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(2));
    expect(mocks.persistDraft.mock.calls[1][0]).toMatchObject({ accountIds: [1], options: { replyTo: { uri: other.uri } } });
  });

  it('keeps the original context if preserving it before switching fails', async () => {
    const target = await render({ replyToPost: post }); input(target, 'textarea', 'Original reply');
    mocks.persistDraft.mockRejectedValueOnce(new Error('Cannot preserve draft'));
    instance!.$set({ quotePost: post, replyToPost: null }); flushSync();
    await vi.waitFor(() => expect(target.querySelector('[role=alert]')?.textContent).toContain('Cannot preserve draft'));
    expect(target.querySelector('textarea')?.value).toBe('Original reply');
    expect(target.textContent).toContain('Replying to @alice.bsky.social');
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(2));
    expect(mocks.persistDraft.mock.calls[1][0].options.replyTo.uri).toBe(post.uri);
    expect(mocks.persistDraft.mock.calls[1][0].options.quoteUri).toBeUndefined();
  });

  it('restores visible reply context and selected destinations without reinitializing them', async () => {
    const context = postContext(post, null);
    saved = { ...snapshot('floating-compose', 'An existing reply', [3], {}, context.options), context: context.display };
    const target = await render({ replyToPost: post });
    expect(target.querySelector('textarea')?.value).toBe('An existing reply');
    expect(target.textContent).toContain('Replying to @alice.bsky.social');
    click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    expect(mocks.persistDraft.mock.calls[0][0].accountIds).toEqual([3]);
  });

  it('never retargets a pending delivery; new-draft explicitly sets it aside in the outbox', async () => {
    const context = postContext(post, null);
    const original = { ...snapshot('floating-compose', 'Pending response', [2], {}, context.options), context: context.display };
    job = pending(original); saved = { ...original, jobId: job.id };
    const target = document.createElement('div'); document.body.append(target);
    instance = createClassComponent({ component: FloatingCompose, target, props: { open: true, quotePost: post } }); flushSync();
    await vi.waitFor(() => expect(target.textContent).toContain('Pending response'));
    expect(target.querySelector('textarea')?.value).toBe('Pending response');
    expect(target.querySelector('input[type=file]')?.matches(':disabled')).toBe(true);
    target.querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); flushSync();
    expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.deliverJob).not.toHaveBeenCalled();
    click(target, 'New draft');
    await vi.waitFor(() => expect(target.querySelector('textarea')?.value).toBe(''));
    expect(target.textContent).not.toContain('Replying to');
    expect(job?.snapshot.text).toBe('Pending response');
    input(target, 'textarea', 'A new standalone post'); click(target, 'Save Draft');
    await vi.waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledTimes(1));
    expect(mocks.persistDraft.mock.calls[0][0].options.replyTo).toBeUndefined();
    expect(mocks.persistDraft.mock.calls[0][0].options.quoteUri).toBeUndefined();
    expect(mocks.persistDraft.mock.calls[0][0].jobId).toBeUndefined();
  });
});
