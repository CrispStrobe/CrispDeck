import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import PublishingColumn from './PublishingColumn.svelte';
import { i18n } from '$lib/i18n.svelte';
import { SCHEDULER_CHANGE } from '$lib/publishing/events';
import {
  cancelPublishingDraft, deletePublishingDraft, loadPublishingEntries, schedulePublishingDraft,
  type PublishingColumnEntry,
} from '$lib/deck-publishing';

vi.mock('$lib/deck-publishing', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/deck-publishing')>(),
  loadPublishingEntries: vi.fn(), cancelPublishingDraft: vi.fn(),
  deletePublishingDraft: vi.fn(), schedulePublishingDraft: vi.fn(),
}));
vi.mock('$lib/toast.svelte', () => ({ toast: { error: vi.fn() } }));

const entry = (id = 1, text = 'A saved post', scheduledAt: string | null = null): PublishingColumnEntry => ({
  draft: { id, text, target_accounts: [1], media_paths: [], visibility: 'public', content_warning: null,
    scheduled_at: scheduledAt, is_sent: false, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z' },
  accountIds: [1], accountNames: ['@writer.example'],
});
const loader = vi.mocked(loadPublishingEntries);
let instance: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  loader.mockResolvedValue([entry()]);
  vi.mocked(cancelPublishingDraft).mockResolvedValue();
  vi.mocked(deletePublishingDraft).mockResolvedValue();
  vi.mocked(schedulePublishingDraft).mockResolvedValue();
});
afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function render(props: Partial<{ type: 'drafts' | 'scheduled'; accountIds: number[]; filterText: string; paused: boolean; refreshKey: number }> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onerror = vi.fn();
  instance = mount(PublishingColumn, { target, props: { type: 'drafts', onerror, ...props } });
  flushSync();
  await tick();
  await tick();
  return { target, onerror };
}

function buttons(target: ParentNode, name: string) {
  return [...target.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent?.trim() === name || button.getAttribute('aria-label') === name);
}
function click(target: ParentNode, name: string, last = false) {
  const matches = buttons(target, name);
  const button = last ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Missing button: ${name}`);
  flushSync(() => button.click());
}
function inputValue(input: HTMLInputElement, value: string) {
  flushSync(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
}

async function settle() { await tick(); await tick(); }

describe('publishing deck column', () => {
  it('renders draft content, target identity, and the edit link without publishing on mount', async () => {
    const { target } = await render();
    expect(target.textContent).toContain('A saved post');
    expect(target.textContent).toContain('@writer.example');
    expect(target.querySelector('a[href="/compose?draft=1"]')?.textContent).toBe(i18n.t.drafts.edit);
    expect(cancelPublishingDraft).not.toHaveBeenCalled();
    expect(deletePublishingDraft).not.toHaveBeenCalled();
    expect(schedulePublishingDraft).not.toHaveBeenCalled();
  });

  it('passes an explicitly empty account selection without broadening it', async () => {
    loader.mockResolvedValue([]);
    const { target } = await render({ accountIds: [] });
    expect(loader).toHaveBeenCalledWith('drafts', []);
    expect(target.textContent).toContain(i18n.t.deck.noSelectedAccounts);
  });

  it('applies the column’s persisted search text to drafts and account names', async () => {
    loader.mockResolvedValue([entry(1, 'Release notes'), entry(2, 'Personal update')]);
    const { target } = await render({ filterText: 'release' });
    expect(target.querySelectorAll('article')).toHaveLength(1);
    expect(target.textContent).toContain('Release notes');
    expect(target.textContent).not.toContain('Personal update');
  });

  it('shows due time, overdue status, and the local scheduling limitation', async () => {
    loader.mockResolvedValue([entry(1, 'Waiting post', '2020-01-01T12:00:00Z')]);
    const { target } = await render({ type: 'scheduled' });
    expect(target.querySelector('time')?.dateTime).toBe('2020-01-01T12:00:00Z');
    expect(target.textContent).toContain(i18n.t.workflow.overdue);
    expect(target.textContent).toContain(i18n.t.workflow.scheduleHint);
    expect(target.textContent).toContain(i18n.t.workflow.timezone);
  });

  it('schedules only after the user submits the date and time form', async () => {
    const { target } = await render();
    click(target, i18n.t.drafts.schedule);
    expect(schedulePublishingDraft).not.toHaveBeenCalled();
    inputValue(target.querySelector('input[type="date"]')!, '2099-12-25');
    inputValue(target.querySelector('input[type="time"]')!, '14:35');
    click(target, i18n.t.compose.schedulePost);
    await settle();
    expect(schedulePublishingDraft).toHaveBeenCalledWith(1, new Date('2099-12-25T14:35').toISOString());
  });

  it('cancels a schedule through the durable service and refreshes the queue', async () => {
    loader.mockResolvedValueOnce([entry(1, 'Scheduled', '2099-12-25T14:35:00Z')]).mockResolvedValue([]);
    const { target } = await render({ type: 'scheduled' });
    click(target, i18n.t.deck.cancelSchedule);
    await settle();
    expect(cancelPublishingDraft).toHaveBeenCalledWith(1);
    expect(target.querySelectorAll('article')).toHaveLength(0);
  });

  it('requires delete confirmation before removing a saved draft', async () => {
    const { target } = await render();
    click(target, i18n.t.drafts.delete);
    expect(deletePublishingDraft).not.toHaveBeenCalled();
    expect(target.textContent).toContain(i18n.t.deck.deleteDraftConfirm);
    click(target, i18n.t.drafts.delete, true);
    await settle();
    expect(deletePublishingDraft).toHaveBeenCalledWith(1);
  });

  it('refreshes on draft and outbox changes and removes those listeners on unmount', async () => {
    await render();
    const initialCalls = loader.mock.calls.length;
    window.dispatchEvent(new Event(SCHEDULER_CHANGE));
    await settle();
    window.dispatchEvent(new Event('crispdeck-outbox-change'));
    await settle();
    expect(loader.mock.calls.length).toBe(initialCalls + 2);
    await unmount(instance!); instance = undefined;
    window.dispatchEvent(new Event(SCHEDULER_CHANGE));
    window.dispatchEvent(new Event('crispdeck-outbox-change'));
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(loader.mock.calls.length).toBe(initialCalls + 2);
  });

  it('pauses automatic updates while allowing an explicit refresh', async () => {
    const { target } = await render({ paused: true });
    const initialCalls = loader.mock.calls.length;
    window.dispatchEvent(new Event(SCHEDULER_CHANGE));
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(loader.mock.calls.length).toBe(initialCalls);
    click(target, i18n.t.deck.refreshColumn);
    await settle();
    expect(loader.mock.calls.length).toBe(initialCalls + 1);
  });

  it('ignores an older response arriving after a newer refresh', async () => {
    let finish!: (value: PublishingColumnEntry[]) => void;
    loader.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue([entry(2, 'Newest state')]);
    const { target } = await render();
    window.dispatchEvent(new Event(SCHEDULER_CHANGE));
    await settle();
    expect(target.textContent).toContain('Newest state');
    finish([entry(1, 'Stale state')]);
    await settle();
    expect(target.textContent).not.toContain('Stale state');
    expect(target.textContent).toContain('Newest state');
  });

  it('shows load failures and recovers when the user refreshes', async () => {
    loader.mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValue([entry()]);
    const { target, onerror } = await render();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(i18n.t.deck.publishingLoadFailed);
    expect(onerror).toHaveBeenCalledOnce();
    click(target, i18n.t.deck.refreshColumn);
    await settle();
    expect(target.querySelector('[role="alert"]')).toBeNull();
    expect(target.textContent).toContain('A saved post');
  });
});
