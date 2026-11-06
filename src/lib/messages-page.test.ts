import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createClassComponent } from 'svelte/legacy';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';

const mocks = vi.hoisted(() => ({ initAllClients: vi.fn() }));
vi.mock('$lib/api/client-factory', () => ({ initAllClients: mocks.initAllClients }));

import MessagesPage from '../routes/messages/+page.svelte';

const accounts = [
  { id: 1, platform: 'bluesky', handle: 'personal.bsky.social', did: 'did:plc:personal', is_primary: true },
  { id: 2, platform: 'bluesky', handle: 'work.bsky.social', did: 'did:plc:work' },
] as Account[];

function message(id: string, text: string, account: Account) {
  return { id, text, sender: { did: account.did }, sentAt: '2026-06-01T12:00:00.000Z' };
}
function clientFixture(account: Account) {
  const convo = {
    id: 'same-conversation-id', muted: false, unreadCount: 1,
    members: [{ did: account.did, handle: account.handle }, { did: `did:plc:peer${account.id}`, handle: `peer${account.id}.bsky.social`, displayName: `Peer ${account.id}` }],
    lastMessage: { text: `Inbox ${account.id}`, sentAt: '2026-06-01T12:00:00.000Z' },
  };
  const listConvos = vi.fn().mockResolvedValue({ data: { convos: [convo] } });
  const getMessages = vi.fn().mockResolvedValue({ data: { messages: [message(`private-${account.id}`, `Private thread ${account.id}`, account)] } });
  const sendMessage = vi.fn().mockImplementation(async ({ message: input }: { message: { text: string } }) => ({ data: message(`confirmed-${account.id}`, input.text, account) }));
  const getConvoForMembers = vi.fn().mockResolvedValue({ data: { convo: { ...convo, id: 'created-on-server' } } });
  const getProfile = vi.fn().mockResolvedValue({ data: { did: 'did:plc:recipient' } });
  const entry = {
    accountId: account.id, platform: 'bluesky', handle: account.handle,
    client: {},
    oauthAgent: { did: account.did, api: { chat: { bsky: { convo: { listConvos, getMessages, sendMessage, getConvoForMembers } } }, app: { bsky: { actor: { getProfile } } } } },
  } as unknown as ClientEntry;
  return { entry, getMessages, sendMessage, getConvoForMembers, getProfile };
}

let personal: ReturnType<typeof clientFixture>;
let work: ReturnType<typeof clientFixture>;
let instance: ReturnType<typeof createClassComponent> | undefined;

beforeEach(() => {
  localStorage.clear();
  mocks.initAllClients.mockReset();
  personal = clientFixture(accounts[0]); work = clientFixture(accounts[1]);
  mocks.initAllClients.mockResolvedValue({ accounts, clients: new Map([[1, personal.entry], [2, work.entry]]) });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => {
  instance?.$destroy(); instance = undefined;
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

async function render(query = '') {
  window.history.replaceState({}, '', `/messages${query}`);
  const target = document.createElement('div'); document.body.append(target);
  instance = createClassComponent({ component: MessagesPage, target });
  flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.querySelectorAll('button[aria-pressed]')).toHaveLength(2); });
  return target;
}
function row(target: HTMLElement, accountHandle: string): HTMLButtonElement {
  const result = [...target.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => button.textContent?.includes(accountHandle));
  if (!result) throw new Error(`Missing conversation for ${accountHandle}`);
  return result;
}
async function select(target: HTMLElement, accountHandle: string) {
  row(target, accountHandle).click(); flushSync();
  await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=log]')?.getAttribute('aria-busy')).toBe('false'); });
}
function input(target: HTMLElement, text: string) {
  const field = target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]');
  if (!field) throw new Error('Message input is unavailable');
  field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  return field;
}
function submitMessage(target: HTMLElement) {
  const field = target.querySelector('input[aria-label="Type a message..."]');
  field?.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); flushSync();
}

/** Mount the real page and service; only the SDK/network boundary is faked. */
describe('account-safe messaging page', () => {
  it('opens a secondary-account deep link and sends through that same account', async () => {
    const target = await render('?account=2&platform=bluesky&conversation=same-conversation-id');
    expect(target.querySelector('[role=log]')?.textContent).toContain('Private thread 2');
    expect(personal.getMessages).not.toHaveBeenCalled();
    expect(row(target, 'work.bsky.social').getAttribute('aria-pressed')).toBe('true');
    expect(row(target, 'personal.bsky.social').getAttribute('aria-pressed')).toBe('false');
    input(target, 'Work reply'); submitMessage(target);
    await vi.waitFor(() => { flushSync(); expect(work.sendMessage).toHaveBeenCalledOnce(); expect(target.querySelector('[role=log]')?.textContent).toContain('Work reply'); });
    expect(personal.sendMessage).not.toHaveBeenCalled();
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('');
  });

  it('shows an unavailable deep link without falling back to an identically named conversation', async () => {
    const target = await render('?account=99&platform=bluesky&conversation=same-conversation-id');
    expect(target.querySelector('[role=alert]')?.textContent).toContain('not available for the selected account');
    expect(personal.getMessages).not.toHaveBeenCalled();
    expect(work.getMessages).not.toHaveBeenCalled();
    expect(target.querySelector('[role=log]')).toBeNull();
  });

  it('ignores a stale read from a previously selected account', async () => {
    let resolvePersonal!: (value: unknown) => void;
    personal.getMessages.mockReturnValueOnce(new Promise(resolve => { resolvePersonal = resolve; }));
    const target = await render();
    row(target, 'personal.bsky.social').click(); flushSync();
    await vi.waitFor(() => expect(personal.getMessages).toHaveBeenCalledOnce());
    await select(target, 'work.bsky.social');
    expect(target.querySelector('[role=log]')?.textContent).toContain('Private thread 2');
    resolvePersonal({ data: { messages: [message('late-private', 'Late personal content', accounts[0])] } });
    await Promise.resolve(); await Promise.resolve(); flushSync();
    expect(target.querySelector('[role=log]')?.textContent).not.toContain('Late personal content');
    expect(row(target, 'work.bsky.social').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a separate unsent draft for each account’s conversation', async () => {
    const target = await render();
    await select(target, 'personal.bsky.social'); input(target, 'Personal draft');
    await select(target, 'work.bsky.social');
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('');
    input(target, 'Work draft');
    await select(target, 'personal.bsky.social');
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('Personal draft');
    await select(target, 'work.bsky.social');
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('Work draft');
  });

  it('does not echo a completed send or clear a draft in a different selected conversation', async () => {
    let resolveSend!: (value: unknown) => void;
    personal.sendMessage.mockReturnValueOnce(new Promise(resolve => { resolveSend = resolve; }));
    const target = await render();
    await select(target, 'work.bsky.social'); input(target, 'Work draft stays');
    await select(target, 'personal.bsky.social'); input(target, 'Sent only to personal'); submitMessage(target);
    await vi.waitFor(() => expect(personal.sendMessage).toHaveBeenCalledOnce());
    await select(target, 'work.bsky.social');
    resolveSend({ data: message('personal-confirmed', 'Sent only to personal', accounts[0]) });
    await vi.waitFor(() => { flushSync(); expect(target.querySelector<HTMLButtonElement>('[aria-label="Send message"]')?.disabled).toBe(false); });
    expect(target.querySelector('[role=log]')?.textContent).not.toContain('Sent only to personal');
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('Work draft stays');
    expect(work.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the draft and shows an error when the selected account rejects a send', async () => {
    work.sendMessage.mockRejectedValueOnce(new Error('Chat permission revoked'));
    const target = await render('?account=2&platform=bluesky&conversation=same-conversation-id');
    input(target, 'Do not lose this draft'); submitMessage(target);
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('Chat permission revoked'); });
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('Do not lose this draft');
    expect(target.querySelector('[role=log]')?.textContent).not.toContain('Do not lose this draft');
    expect(personal.sendMessage).not.toHaveBeenCalled();
  });

  it('creates a conversation with the explicitly selected sending account', async () => {
    const target = await render();
    const newButton = [...target.querySelectorAll('button')].find(button => button.textContent?.includes('New Conversation'));
    newButton?.click(); flushSync();
    const accountSelect = target.querySelector('select')!;
    accountSelect.value = '2'; accountSelect.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    const field = target.querySelector<HTMLInputElement>('input[aria-label="@user or handle..."]')!;
    field.value = '@recipient.bsky.social'; field.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    field.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); flushSync();
    await vi.waitFor(() => expect(work.getConvoForMembers).toHaveBeenCalledOnce());
    expect(personal.getConvoForMembers).not.toHaveBeenCalled();
    expect(work.getProfile).toHaveBeenCalledWith({ actor: 'recipient.bsky.social' });
    await vi.waitFor(() => expect(work.getMessages).toHaveBeenCalledWith({ convoId: 'created-on-server', limit: 50 }, expect.anything()));
    expect(personal.sendMessage).not.toHaveBeenCalled();
    expect(work.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the selected account and draft through overlapping reconnection events and uses its refreshed client', async () => {
    const target = await render();
    await select(target, 'work.bsky.social'); input(target, 'Draft survives reconnection');
    let releaseStale!: (value: unknown) => void;
    const restored = clientFixture(accounts[1]);
    restored.getMessages.mockResolvedValue({ data: { messages: [message('restored', 'Reconnected private thread', accounts[1])] } });
    mocks.initAllClients.mockImplementationOnce(() => new Promise(resolve => { releaseStale = resolve; }))
      .mockResolvedValueOnce({ accounts, clients: new Map([[1, personal.entry], [2, restored.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: false } }));
    flushSync();
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: false } }));
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=log]')?.textContent).toContain('Reconnected private thread'); });
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('Draft survives reconnection');
    releaseStale({ accounts, clients: new Map([[1, personal.entry], [2, work.entry]]) });
    await Promise.resolve(); await Promise.resolve(); flushSync();
    submitMessage(target);
    await vi.waitFor(() => expect(restored.sendMessage).toHaveBeenCalledOnce());
    expect(work.sendMessage).not.toHaveBeenCalled(); expect(personal.sendMessage).not.toHaveBeenCalled();
    expect(work.getMessages).toHaveBeenCalledOnce();
  });

  it('retires an in-flight private read when its account is removed without switching to another account', async () => {
    let releaseRead!: (value: unknown) => void;
    work.getMessages.mockReturnValueOnce(new Promise(resolve => { releaseRead = resolve; }));
    const target = await render();
    row(target, 'work.bsky.social').click(); flushSync();
    await vi.waitFor(() => expect(work.getMessages).toHaveBeenCalledOnce());
    mocks.initAllClients.mockResolvedValue({ accounts: [accounts[0]], clients: new Map([[1, personal.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    await vi.waitFor(() => { flushSync(); expect(target.querySelectorAll('button[aria-pressed]')).toHaveLength(1); });
    expect(target.querySelector('[role=alert]')?.textContent).toContain('not available for the selected account');
    releaseRead({ data: { messages: [message('late', 'Removed account private content', accounts[1])] } });
    await Promise.resolve(); await Promise.resolve(); flushSync();
    expect(target.textContent).not.toContain('Removed account private content');
    expect(target.querySelector('[role=log]')).toBeNull();
    expect(personal.getMessages).not.toHaveBeenCalled();
  });

  it('does not carry a private draft or selection to a different actor reusing a local account ID', async () => {
    const target = await render();
    await select(target, 'work.bsky.social'); input(target, 'For the original actor only');
    const replacementAccount = { ...accounts[1], did: 'did:plc:replacement' };
    const replacement = clientFixture(replacementAccount);
    mocks.initAllClients.mockResolvedValue({ accounts: [accounts[0], replacementAccount], clients: new Map([[1, personal.entry], [2, replacement.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('[role=alert]')?.textContent).toContain('not available for the selected account'); });
    expect(replacement.getMessages).not.toHaveBeenCalled();
    await select(target, 'work.bsky.social');
    expect(target.querySelector<HTMLInputElement>('input[aria-label="Type a message..."]')?.value).toBe('');
    expect(replacement.sendMessage).not.toHaveBeenCalled(); expect(work.sendMessage).not.toHaveBeenCalled();
    instance?.$destroy(); instance = undefined;
    const count = mocks.initAllClients.mock.calls.length;
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    expect(mocks.initAllClients).toHaveBeenCalledTimes(count);
  });

  it('requires another explicit destination after a new-chat account is disconnected', async () => {
    const target = await render();
    [...target.querySelectorAll('button')].find(button => button.textContent?.includes('New Conversation'))!.click(); flushSync();
    const accountSelect = target.querySelector('select')!;
    accountSelect.value = '2'; accountSelect.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    const recipient = target.querySelector<HTMLInputElement>('input[aria-label="@user or handle..."]')!;
    recipient.value = 'recipient.bsky.social'; recipient.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    mocks.initAllClients.mockResolvedValue({ accounts: [accounts[0]], clients: new Map([[1, personal.entry]]) });
    window.dispatchEvent(new CustomEvent('crispdeck:accounts-changed', { detail: { membershipChanged: true } }));
    await vi.waitFor(() => { flushSync(); expect(target.querySelector('select')).not.toBeNull(); });
    const submit = target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    expect(target.querySelector<HTMLInputElement>('input[aria-label="@user or handle..."]')?.value).toBe('recipient.bsky.social');
    expect(personal.getConvoForMembers).not.toHaveBeenCalled(); expect(work.getConvoForMembers).not.toHaveBeenCalled();
  });
});
