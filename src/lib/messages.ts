/**
 * Conversation list model.
 *
 * These types and rules lived inside the messages page, where nothing could
 * import them, so the tests kept their own copies.
 */
import type { Account, Platform } from '$lib/types';
import type { Agent, ChatBskyConvoDefs } from '@atproto/api';
import type { ClientEntry } from './api/client-factory';
import type { BlueskyClient } from './api/bluesky';
import type { MastodonClient } from './api/mastodon';
import { fetchJson, safeUrl } from './http';

export interface Conversation {
  id: string;
  platform: Platform;
  /** The local account that owns this private conversation. Never infer it. */
  accountId?: number;
  participant: { handle: string; displayName?: string; avatar?: string };
  members?: { did: string; handle: string; displayName?: string; avatar?: string }[];
  /** Mastodon DMs are direct statuses; replies must retain their thread. */
  lastStatusId?: string;
  recipientHandles?: string[];
  isNew?: boolean;
  lastMessage?: string;
  lastDate?: string;
  unread: boolean;
}

export interface Message {
  id: string;
  text: string;
  sender: { handle: string; displayName?: string; avatar?: string };
  createdAt: string;
  isOurs: boolean;
}

/** How many conversations are waiting, for the nav badge. */
export function countUnread(conversations: Conversation[]): number {
  return conversations.filter((c) => c.unread).length;
}

/**
 * Most recent first. A conversation with no date sorts last rather than
 * jumping to the top, which is what comparing undefined would do.
 */
export function sortByRecent(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
}

/**
 * Which network a typed handle belongs to.
 *
 * Mastodon handles carry an @; Bluesky handles are bare domains. Note this
 * treats anything with an @ as Mastodon, so a Bluesky handle typed with a
 * leading @ would be misread — clean it with cleanBskyHandle first.
 */
export function inferPlatformFromHandle(handle: string): Platform {
  return handle.includes('@') ? 'mastodon' : 'bluesky';
}

/**
 * Compact age for a conversation row: minutes, then hours, then a date.
 *
 * Deliberately not $lib/time-format's relativeTime — this one has no "now"
 * bucket and no day counter, because a conversation list shows fewer, older
 * entries than a timeline does.
 */
export function formatConversationTime(dateStr: string, now: number = Date.now()): string {
  const d = new Date(dateStr);
  const diff = now - d.getTime();
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** IDs can collide across accounts, especially across Mastodon instances. */
export function conversationKey(conversation: Conversation): string {
  return `${conversation.platform}:${conversation.accountId ?? 'unknown'}:${conversation.id}`;
}

export function findLinkedConversation(conversations: Conversation[], params: URLSearchParams): Conversation | undefined {
  const id = params.get('conversation');
  const owner = params.get('account');
  const platform = params.get('platform');
  if (!id || !owner || !/^\d+$/.test(owner) || !['bluesky', 'mastodon'].includes(platform ?? '')) return undefined;
  const accountId = Number(owner);
  if (!Number.isSafeInteger(accountId) || accountId < 1) return undefined;
  return conversations.find(conversation => conversation.id === id && conversation.accountId === accountId && conversation.platform === platform);
}

function conversationOwner(conversation: Pick<Conversation, 'accountId' | 'platform'>, accounts: Account[], clients: Map<number, ClientEntry>): { account: Account; entry: ClientEntry } {
  const account = accounts.find(candidate => candidate.id === conversation.accountId && candidate.platform === conversation.platform);
  const entry = conversation.accountId === undefined ? undefined : clients.get(conversation.accountId);
  if (!account || !entry || entry.accountId !== account.id || entry.platform !== account.platform) {
    throw new Error('The account that owns this conversation is disconnected. Reconnect it in Settings.');
  }
  if (account.platform === 'threads') throw new Error('Threads messaging is not available through its API.');
  return { account, entry };
}

export const BLUESKY_CHAT_HEADERS = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };

async function chatAgent(account: Account, entry: ClientEntry): Promise<{ agent: Agent; did: string }> {
  let agent = entry.oauthAgent;
  if (!agent) {
    const client = entry.client as BlueskyClient;
    await client.login();
    if (!client.isAuthenticated()) throw new Error('Reconnect this Bluesky account with OAuth or an app password with chat access.');
    agent = client.getAgent();
  }
  const did = agent.did;
  // A global "last OAuth session" can belong to another account. The caller
  // must supply this account's own restored agent, with a matching identity.
  if (!did || (account.did && did !== account.did)) {
    throw new Error('The Bluesky session does not match this conversation’s account. Reconnect it in Settings.');
  }
  return { agent, did };
}

interface MastodonActor {
  id: string;
  acct: string;
  display_name?: string;
  avatar?: string;
}
interface DirectStatus {
  id: string;
  content: string;
  created_at: string;
  visibility: string;
  account: MastodonActor;
}
interface MastodonConversation {
  id: string;
  accounts: MastodonActor[];
  last_status?: DirectStatus | null;
  unread: boolean;
}

function mastodonConnection(entry: ClientEntry): { origin: string; token: string } {
  const client = entry.client as MastodonClient;
  const token = client.getAccessToken();
  if (!token) throw new Error('Reconnect this Mastodon account in Settings.');
  const url = new URL(client.getInstanceUrl());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid Mastodon server address.');
  return { origin: url.origin, token };
}

async function mastodonMessageRequest<T>(entry: ClientEntry, path: string, body?: unknown): Promise<T> {
  const { origin, token } = mastodonConnection(entry);
  return fetchJson<T>(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
  }, body === undefined ? 'Load conversation' : 'Send message');
}

function mastodonHandle(actor: MastodonActor, entry: ClientEntry): string {
  const handle = actor.acct.replace(/^@/, '');
  return `@${handle.includes('@') ? handle : `${handle}@${new URL((entry.client as MastodonClient).getInstanceUrl()).hostname}`}`;
}

function listResponse<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error('The messaging service returned an invalid response.');
  return value as T[];
}

function fromBlueskyConversation(raw: ChatBskyConvoDefs.ConvoView, account: Account, did: string): Conversation {
  const other = raw.members.find(member => member.did !== did) ?? raw.members[0];
  const deleted = other?.handle === 'missing.invalid' || other?.handle === 'handle.invalid';
  const last = raw.lastMessage as { text?: string; sentAt?: string } | undefined;
  return {
    id: raw.id, platform: 'bluesky', accountId: account.id,
    participant: { handle: deleted ? 'Deleted account' : other?.handle ?? '?', displayName: deleted ? 'Deleted account' : other?.displayName, avatar: deleted ? undefined : other?.avatar },
    members: raw.members.map(member => ({ did: member.did, handle: member.handle, displayName: member.displayName, avatar: member.avatar })),
    lastMessage: last?.text, lastDate: last?.sentAt, unread: raw.unreadCount > 0,
  };
}

function fromMastodonConversation(raw: MastodonConversation, account: Account, entry: ClientEntry): Conversation {
  const other = raw.accounts.find(actor => actor.id !== account.mastodon_id) ?? raw.accounts[0];
  return {
    id: raw.id, platform: 'mastodon', accountId: account.id,
    participant: { handle: other ? mastodonHandle(other, entry) : '?', displayName: other?.display_name, avatar: other?.avatar },
    recipientHandles: raw.accounts.filter(actor => actor.id !== account.mastodon_id).map(actor => mastodonHandle(actor, entry)),
    lastStatusId: raw.last_status?.id,
    lastMessage: raw.last_status?.content.replace(/<[^>]*>?/gm, ''),
    lastDate: raw.last_status?.created_at, unread: raw.unread,
  };
}

export function messageErrorMessage(reason: unknown, entry?: ClientEntry): string {
  let text = reason instanceof Error ? reason.message : 'The messaging request failed.';
  if (entry?.platform === 'mastodon') {
    const token = (entry.client as MastodonClient).getAccessToken();
    if (token) text = text.split(token).join('[redacted]');
  }
  return text.replace(/https?:\/\/[^\s<>"']+/g, url => safeUrl(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(access_token|refresh_token|accessJwt|refreshJwt|app_password|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 300);
}

/** One failure must not hide the other accounts' inboxes. */
export async function loadConversationInbox(accounts: Account[], clients: Map<number, ClientEntry>): Promise<{ conversations: Conversation[]; errors: { accountId: number; message: string }[] }> {
  const eligible = accounts.filter(account => account.platform === 'bluesky' || account.platform === 'mastodon');
  const results = await Promise.allSettled(eligible.map(async account => {
    const { entry } = conversationOwner({ accountId: account.id, platform: account.platform }, accounts, clients);
    if (account.platform === 'bluesky') {
      const { agent, did } = await chatAgent(account, entry);
      const response = await agent.api.chat.bsky.convo.listConvos({ limit: 50 }, { headers: BLUESKY_CHAT_HEADERS });
      return listResponse<ChatBskyConvoDefs.ConvoView>(response.data.convos).map(convo => fromBlueskyConversation(convo, account, did));
    }
    const response = await mastodonMessageRequest<MastodonConversation[]>(entry, '/api/v1/conversations?limit=40');
    return listResponse<MastodonConversation>(response).map(convo => fromMastodonConversation(convo, account, entry));
  }));
  const conversations: Conversation[] = [];
  const errors: { accountId: number; message: string }[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') conversations.push(...result.value);
    else errors.push({ accountId: eligible[index].id, message: messageErrorMessage(result.reason, clients.get(eligible[index].id)) });
  });
  return { conversations: sortByRecent(conversations), errors };
}

function fromBlueskyMessage(raw: ChatBskyConvoDefs.MessageView | ChatBskyConvoDefs.DeletedMessageView, conversation: Conversation, account: Account, did: string): Message {
  const ours = raw.sender.did === did;
  const member = conversation.members?.find(member => member.did === raw.sender.did);
  return {
    id: raw.id, text: 'text' in raw ? raw.text : 'Message deleted', createdAt: raw.sentAt, isOurs: ours,
    sender: ours ? { handle: account.handle, displayName: account.display_name ?? undefined, avatar: account.avatar_url ?? undefined } : member ?? conversation.participant,
  };
}

function fromMastodonMessage(raw: DirectStatus, entry: ClientEntry, selfId: string): Message {
  return {
    id: raw.id, text: raw.content.replace(/<[^>]*>?/gm, ''), createdAt: raw.created_at,
    sender: { handle: mastodonHandle(raw.account, entry), displayName: raw.account.display_name, avatar: raw.account.avatar },
    isOurs: raw.account.id === selfId,
  };
}

async function mastodonSelfId(account: Account, entry: ClientEntry): Promise<string> {
  if (account.mastodon_id) return account.mastodon_id;
  const profile = await mastodonMessageRequest<MastodonActor>(entry, '/api/v1/accounts/verify_credentials');
  if (!profile.id) throw new Error('Could not verify this Mastodon account.');
  return profile.id;
}

export async function loadConversationMessages(conversation: Conversation, accounts: Account[], clients: Map<number, ClientEntry>): Promise<Message[]> {
  const { account, entry } = conversationOwner(conversation, accounts, clients);
  if (conversation.isNew) return [];
  if (account.platform === 'bluesky') {
    const { agent, did } = await chatAgent(account, entry);
    const response = await agent.api.chat.bsky.convo.getMessages({ convoId: conversation.id, limit: 50 }, { headers: BLUESKY_CHAT_HEADERS });
    return listResponse<ChatBskyConvoDefs.MessageView | ChatBskyConvoDefs.DeletedMessageView>(response.data.messages).map(message => fromBlueskyMessage(message, conversation, account, did)).reverse();
  }
  // Match the server's conversation id, never just the participant's handle:
  // two conversations with the same person can be different threads.
  let lastStatusId = conversation.lastStatusId;
  if (!lastStatusId) {
    const inbox = await mastodonMessageRequest<MastodonConversation[]>(entry, '/api/v1/conversations?limit=40');
    lastStatusId = listResponse<MastodonConversation>(inbox).find(candidate => candidate.id === conversation.id)?.last_status?.id;
  }
  if (!lastStatusId) throw new Error('This conversation is no longer available. Refresh your inbox.');
  const statusPath = `/api/v1/statuses/${encodeURIComponent(lastStatusId)}`;
  const [status, context, selfId] = await Promise.all([
    mastodonMessageRequest<DirectStatus>(entry, statusPath),
    mastodonMessageRequest<{ ancestors: DirectStatus[]; descendants: DirectStatus[] }>(entry, `${statusPath}/context`),
    mastodonSelfId(account, entry),
  ]);
  const seen = new Set<string>();
  return [...listResponse<DirectStatus>(context.ancestors), status, ...listResponse<DirectStatus>(context.descendants)]
    .filter(status => {
      if (status.visibility !== 'direct' || seen.has(status.id)) return false;
      seen.add(status.id);
      return true;
    })
    .map(status => fromMastodonMessage(status, entry, selfId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Send only through the conversation's owner, returning the real server message. */
export async function sendConversationMessage(conversation: Conversation, text: string, accounts: Account[], clients: Map<number, ClientEntry>): Promise<Message> {
  const { account, entry } = conversationOwner(conversation, accounts, clients);
  const content = text.trim();
  if (!content) throw new Error('Enter a message before sending.');
  if (account.platform === 'bluesky') {
    const { agent, did } = await chatAgent(account, entry);
    const result = await agent.api.chat.bsky.convo.sendMessage({ convoId: conversation.id, message: { text: content } }, { encoding: 'application/json', headers: BLUESKY_CHAT_HEADERS });
    return fromBlueskyMessage(result.data, conversation, account, did);
  }
  const recipients = [...new Set(conversation.recipientHandles?.length ? conversation.recipientHandles : [conversation.participant.handle])];
  if (recipients.some(handle => !/^@[^\s@]+@[^\s@]+$/.test(handle))) throw new Error('Choose a valid Mastodon recipient before sending.');
  const status = await mastodonMessageRequest<DirectStatus>(entry, '/api/v1/statuses', {
    status: `${recipients.join(' ')} ${content}`, visibility: 'direct',
    ...(conversation.lastStatusId ? { in_reply_to_id: conversation.lastStatusId } : {}),
  });
  if (!status.id || status.visibility !== 'direct') throw new Error('The server did not confirm a direct message.');
  return fromMastodonMessage(status, entry, account.mastodon_id ?? status.account.id);
}

/** Account selection determines the platform; a leading @ must not change it. */
export async function createConversation(accountId: number, handle: string, accounts: Account[], clients: Map<number, ClientEntry>): Promise<Conversation> {
  const selected = accounts.find(account => account.id === accountId);
  if (!selected) throw new Error('Select a connected account.');
  const { account, entry } = conversationOwner({ accountId, platform: selected.platform }, accounts, clients);
  const actor = handle.trim().replace(/^@/, '');
  if (!actor) throw new Error('Enter a recipient handle.');
  if (account.platform === 'bluesky') {
    const { agent, did } = await chatAgent(account, entry);
    const profile = await agent.api.app.bsky.actor.getProfile({ actor });
    const result = await agent.api.chat.bsky.convo.getConvoForMembers({ members: [profile.data.did] }, { headers: BLUESKY_CHAT_HEADERS });
    return fromBlueskyConversation(result.data.convo, account, did);
  }
  const profile = await mastodonMessageRequest<MastodonActor>(entry, `/api/v1/accounts/lookup?${new URLSearchParams({ acct: actor })}`);
  const recipient = mastodonHandle(profile, entry);
  return { id: `new-${crypto.randomUUID()}`, accountId, platform: 'mastodon', participant: { handle: recipient, displayName: profile.display_name, avatar: profile.avatar }, recipientHandles: [recipient], unread: false, isNew: true };
}
