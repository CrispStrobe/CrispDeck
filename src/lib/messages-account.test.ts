import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './types';
import type { ClientEntry } from './api/client-factory';
import {
  BLUESKY_CHAT_HEADERS, conversationKey, findLinkedConversation, loadConversationInbox,
  loadConversationMessages, sendConversationMessage, createConversation, type Conversation,
} from './messages';

function bskyAccount(id: number): Account {
  return { id, platform: 'bluesky', handle: `reader${id}.bsky.social`, did: `did:plc:reader${id}`, is_primary: id === 1 } as Account;
}
function mastoAccount(id: number): Account {
  return { id, platform: 'mastodon', handle: `@reader@server${id}.example`, mastodon_id: `self-${id}`, instance_url: `https://server${id}.example` } as Account;
}
function conversation(account: Account, overrides: Partial<Conversation> = {}): Conversation {
  return { id: 'shared-id', platform: account.platform, accountId: account.id, participant: { handle: account.platform === 'bluesky' ? 'peer.bsky.social' : '@peer@remote.example' }, unread: false, ...overrides };
}
function rawConvo(account: Account) {
  return { id: 'shared-id', members: [{ did: account.did, handle: account.handle }, { did: 'did:plc:peer', handle: 'peer.bsky.social' }], unreadCount: 1, muted: false, lastMessage: { text: `Inbox ${account.id}`, sentAt: '2026-06-01T12:00:00.000Z' } };
}
function bskyEntry(account: Account, oauth = true) {
  const listConvos = vi.fn().mockResolvedValue({ data: { convos: [rawConvo(account)] } });
  const getMessages = vi.fn().mockResolvedValue({ data: { messages: [{ id: `message-${account.id}`, sender: { did: account.did }, text: `Private ${account.id}`, sentAt: '2026-06-01T12:00:00.000Z' }] } });
  const sendMessage = vi.fn().mockImplementation(async ({ message }: { message: { text: string } }) => ({ data: { id: `sent-${account.id}`, sender: { did: account.did }, text: message.text, sentAt: '2026-06-02T12:00:00.000Z' } }));
  const getProfile = vi.fn().mockResolvedValue({ data: { did: 'did:plc:peer' } });
  const getConvoForMembers = vi.fn().mockResolvedValue({ data: { convo: { ...rawConvo(account), id: 'real-conversation-id' } } });
  const agent = { did: account.did, api: { chat: { bsky: { convo: { listConvos, getMessages, sendMessage, getConvoForMembers } } }, app: { bsky: { actor: { getProfile } } } } };
  const client = { login: vi.fn().mockResolvedValue(undefined), isAuthenticated: vi.fn().mockReturnValue(!oauth), getAgent: vi.fn().mockReturnValue(agent) };
  const entry = { accountId: account.id, handle: account.handle, platform: 'bluesky', client, ...(oauth ? { oauthAgent: agent } : {}) } as unknown as ClientEntry;
  return { entry, client, agent, listConvos, getMessages, sendMessage, getProfile, getConvoForMembers };
}
function mastoEntry(account: Account, token = `token-${account.id}`): ClientEntry {
  return { accountId: account.id, handle: account.handle, platform: 'mastodon', client: { getAccessToken: () => token, getInstanceUrl: () => account.instance_url } } as unknown as ClientEntry;
}
function directStatus(id: string, selfId = 'peer-id', text = 'Private text') {
  return { id, content: `<p>${text}</p>`, created_at: '2026-06-01T12:00:00.000Z', visibility: 'direct', account: { id: selfId, acct: 'peer@remote.example', display_name: 'Peer' } };
}
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockRejectedValue(new Error('Unexpected network request')); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('private conversation ownership', () => {
  it('keeps identical remote conversation IDs distinct across accounts', () => {
    const first = conversation(bskyAccount(1)), second = conversation(bskyAccount(2));
    expect(conversationKey(first)).not.toBe(conversationKey(second));
    expect(findLinkedConversation([first, second], new URLSearchParams('account=2&platform=bluesky&conversation=shared-id'))).toBe(second);
  });

  it.each([
    'conversation=shared-id',
    'account=1&conversation=shared-id',
    'account=1&platform=mastodon&conversation=shared-id',
    'account=99&platform=bluesky&conversation=shared-id',
    'account=1.0&platform=bluesky&conversation=shared-id',
  ])('does not guess an account for an incomplete or mismatched deep link: %s', query => {
    expect(findLinkedConversation([conversation(bskyAccount(1))], new URLSearchParams(query))).toBeUndefined();
  });

  it('assigns receiving accounts to every inbox and uses the chat proxy on each OAuth agent', async () => {
    const first = bskyAccount(1), second = bskyAccount(2), a = bskyEntry(first), b = bskyEntry(second);
    const inbox = await loadConversationInbox([first, second], new Map([[1, a.entry], [2, b.entry]]));
    expect(inbox.errors).toEqual([]);
    expect(inbox.conversations.map(convo => convo.accountId)).toEqual([1, 2]);
    expect(new Set(inbox.conversations.map(conversationKey)).size).toBe(2);
    for (const fixture of [a, b]) {
      expect(fixture.listConvos).toHaveBeenCalledWith({ limit: 50 }, { headers: BLUESKY_CHAT_HEADERS });
      expect(fixture.client.login).not.toHaveBeenCalled();
    }
  });

  it('reads and sends through a secondary Bluesky account instead of the first account', async () => {
    const first = bskyAccount(1), second = bskyAccount(2), a = bskyEntry(first), b = bskyEntry(second);
    const clients = new Map([[1, a.entry], [2, b.entry]]);
    const convo = conversation(second);
    const loaded = await loadConversationMessages(convo, [first, second], clients);
    expect(loaded).toMatchObject([{ text: 'Private 2', isOurs: true, sender: { handle: second.handle } }]);
    expect(a.getMessages).not.toHaveBeenCalled();
    expect(b.getMessages).toHaveBeenCalledWith({ convoId: 'shared-id', limit: 50 }, { headers: BLUESKY_CHAT_HEADERS });
    const sent = await sendConversationMessage(convo, '  For work  ', [first, second], clients);
    expect(sent).toMatchObject({ id: 'sent-2', text: 'For work', isOurs: true });
    expect(a.sendMessage).not.toHaveBeenCalled();
    expect(b.sendMessage).toHaveBeenCalledWith({ convoId: 'shared-id', message: { text: 'For work' } }, { encoding: 'application/json', headers: BLUESKY_CHAT_HEADERS });
  });

  it.each([undefined, 99])('fails closed for missing or removed conversation account %s', async owner => {
    const first = bskyAccount(1), fixture = bskyEntry(first), clients = new Map([[1, fixture.entry]]);
    const convo = conversation(first, { accountId: owner });
    await expect(loadConversationMessages(convo, [first], clients)).rejects.toThrow('owns this conversation');
    await expect(sendConversationMessage(convo, 'Private content', [first], clients)).rejects.toThrow('owns this conversation');
    expect(fixture.getMessages).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a restored OAuth agent whose DID belongs to a different account', async () => {
    const account = bskyAccount(2), fixture = bskyEntry(account);
    fixture.agent.did = 'did:plc:reader1';
    await expect(sendConversationMessage(conversation(account), 'Private content', [account], new Map([[2, fixture.entry]]))).rejects.toThrow('does not match');
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('allows an app password with chat access using that account’s own agent', async () => {
    const account = bskyAccount(2), fixture = bskyEntry(account, false);
    const sent = await sendConversationMessage(conversation(account), 'Hello', [account], new Map([[2, fixture.entry]]));
    expect(fixture.client.login).toHaveBeenCalledOnce();
    expect(fixture.client.getAgent).toHaveBeenCalledOnce();
    expect(sent.id).toBe('sent-2');
  });

  it('does not hide another account’s inbox when one chat permission is unavailable', async () => {
    const first = bskyAccount(1), second = bskyAccount(2), a = bskyEntry(first), b = bskyEntry(second);
    b.listConvos.mockRejectedValue(new Error('Chat permission required'));
    const result = await loadConversationInbox([first, second], new Map([[1, a.entry], [2, b.entry]]));
    expect(result.conversations).toHaveLength(1);
    expect(result.errors).toEqual([{ accountId: 2, message: 'Chat permission required' }]);
  });

  it('creates a real Bluesky conversation for the selected account, including a leading @ handle', async () => {
    const first = bskyAccount(1), second = bskyAccount(2), a = bskyEntry(first), b = bskyEntry(second);
    const convo = await createConversation(2, '@peer.bsky.social', [first, second], new Map([[1, a.entry], [2, b.entry]]));
    expect(convo).toMatchObject({ id: 'real-conversation-id', accountId: 2, platform: 'bluesky' });
    expect(a.getProfile).not.toHaveBeenCalled();
    expect(b.getProfile).toHaveBeenCalledWith({ actor: 'peer.bsky.social' });
    expect(b.getConvoForMembers).toHaveBeenCalledWith({ members: ['did:plc:peer'] }, { headers: BLUESKY_CHAT_HEADERS });
    expect(b.sendMessage).not.toHaveBeenCalled();
  });
});

describe('Mastodon direct message ownership and threading', () => {
  it('uses the correct instance and token for inboxes with colliding conversation IDs', async () => {
    const first = mastoAccount(3), second = mastoAccount(4);
    fetchMock.mockImplementation(async () => response([{ id: 'shared-id', accounts: [{ id: 'peer', acct: 'peer' }], last_status: directStatus('last'), unread: true }]));
    const inbox = await loadConversationInbox([first, second], new Map([[3, mastoEntry(first)], [4, mastoEntry(second)]]));
    expect(inbox.conversations.map(convo => [convo.accountId, convo.participant.handle])).toEqual([[3, '@peer@server3.example'], [4, '@peer@server4.example']]);
    expect(fetchMock.mock.calls.map(([url, init]) => [new URL(String(url)).origin, (init?.headers as Record<string, string>).Authorization])).toEqual([['https://server3.example', 'Bearer token-3'], ['https://server4.example', 'Bearer token-4']]);
  });

  it('loads a secondary-account thread and identifies own messages by exact account ID', async () => {
    const first = mastoAccount(3), second = mastoAccount(4);
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/context')) {
        return response({ ancestors: [directStatus('previous', 'peer-id', 'Peer message'), { ...directStatus('public'), visibility: 'public' }], descendants: [] });
      }
      return response(directStatus('last', 'self-4', 'Our message'));
    });
    const messages = await loadConversationMessages(conversation(second, { lastStatusId: 'last' }), [first, second], new Map([[3, mastoEntry(first)], [4, mastoEntry(second)]]));
    expect(messages.map(message => [message.id, message.isOurs])).toEqual([['previous', false], ['last', true]]);
    expect(fetchMock.mock.calls.every(([url, init]) => new URL(String(url)).origin === 'https://server4.example' && (init?.headers as Record<string, string>).Authorization === 'Bearer token-4')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('matches the conversation ID instead of another thread with the same participant', async () => {
    const account = mastoAccount(4);
    fetchMock.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/conversations') return response([
        { id: 'another-thread', accounts: [{ id: 'peer', acct: 'peer@remote.example' }], last_status: directStatus('wrong-last') },
        { id: 'shared-id', accounts: [{ id: 'peer', acct: 'peer@remote.example' }], last_status: directStatus('correct-last') },
      ]);
      if (url.pathname.endsWith('/context')) return response({ ancestors: [], descendants: [] });
      return response(directStatus('correct-last'));
    });
    await loadConversationMessages(conversation(account), [account], new Map([[4, mastoEntry(account)]]));
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('wrong-last'))).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/statuses/correct-last'))).toBe(true);
  });

  it('sends a direct reply from the owner while preserving every conversation recipient', async () => {
    const first = mastoAccount(3), second = mastoAccount(4);
    fetchMock.mockResolvedValueOnce(response(directStatus('server-message-id', 'self-4', 'Confirmed')));
    const sent = await sendConversationMessage(conversation(second, { lastStatusId: 'previous-status', recipientHandles: ['@peer@remote.example', '@other@remote.example'] }), 'Hello both', [first, second], new Map([[3, mastoEntry(first)], [4, mastoEntry(second)]]));
    expect(sent).toMatchObject({ id: 'server-message-id', isOurs: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://server4.example/api/v1/statuses');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer token-4' } });
    expect(JSON.parse(String(init?.body))).toEqual({ status: '@peer@remote.example @other@remote.example Hello both', visibility: 'direct', in_reply_to_id: 'previous-status' });
  });

  it('does not send from a different connected account when the owner token is missing', async () => {
    const first = mastoAccount(3), second = mastoAccount(4);
    await expect(sendConversationMessage(conversation(second), 'Private content', [first, second], new Map([[3, mastoEntry(first)], [4, mastoEntry(second, '')]]))).rejects.toThrow('Reconnect');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates a rejected send without returning a fabricated sent message', async () => {
    const account = mastoAccount(4);
    fetchMock.mockResolvedValueOnce(response({ error: 'Permission denied' }, 403));
    await expect(sendConversationMessage(conversation(account), 'Private content', [account], new Map([[4, mastoEntry(account)]]))).rejects.toThrow('403');
  });

  it('resolves new Mastodon recipients on the explicitly selected instance', async () => {
    const first = mastoAccount(3), second = mastoAccount(4);
    fetchMock.mockResolvedValueOnce(response({ id: 'peer', acct: 'peer@remote.example', display_name: 'Peer' }));
    const convo = await createConversation(4, '@peer@remote.example', [first, second], new Map([[3, mastoEntry(first)], [4, mastoEntry(second)]]));
    expect(convo).toMatchObject({ accountId: 4, platform: 'mastodon', recipientHandles: ['@peer@remote.example'], isNew: true });
    expect(new URL(String(fetchMock.mock.calls[0][0])).origin).toBe('https://server4.example');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });
});
