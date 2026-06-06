<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { MessageSquare, Loader2, Send, ArrowLeft } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { BlueskyClient } from '$lib/api/bluesky';
  import { MastodonClient } from '$lib/api/mastodon';
  import { resumeBlueskyOAuthSession } from '$lib/api/bluesky-oauth';
  import { Agent } from '@atproto/api';
  import type { Account, Platform } from '$lib/types';

  interface Conversation {
    id: string;
    platform: Platform;
    participant: { handle: string; displayName?: string; avatar?: string };
    lastMessage?: string;
    lastDate?: string;
    unread: boolean;
  }

  interface Message {
    id: string;
    text: string;
    sender: { handle: string; displayName?: string; avatar?: string };
    createdAt: string;
    isOurs: boolean;
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let conversations: Conversation[] = $state([]);
  let selectedConvo: Conversation | null = $state(null);
  let messages: Message[] = $state([]);
  let loadingMessages = $state(false);
  let newMessage = $state('');
  let sending = $state(false);
  let showNewConvo = $state(false);
  let newConvoHandle = $state('');
  let bskyDmNote = $state(false);

  let clientEntries: Map<number, ClientEntry> = new Map();

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;
      await loadConversations();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadConversations() {
    const all: Conversation[] = [];

    for (const [id, entry] of clientEntries) {
      const acct = accounts.find(a => a.id === id);
      if (!acct) continue;

      if (acct.platform === 'bluesky') {
        // Try OAuth agent from client-factory first, fall back to resumeBlueskyOAuthSession
        const oauthAgent = entry.oauthAgent;
        const oauthSession = oauthAgent ? { agent: oauthAgent, did: acct.did } : await resumeBlueskyOAuthSession();
        if (oauthSession) {
          try {
            const proxyHeaders = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
            const agent = oauthSession.agent as any;
            const chatResp = await agent.api.chat.bsky.convo.listConvos(
              { limit: 50 },
              { headers: proxyHeaders }
            );
            for (const convo of chatResp.data.convos ?? []) {
              const other = convo.members?.find((m: any) => m.handle !== acct.handle) ?? convo.members?.[0];
              const handle = other?.handle ?? '?';
              const isDeleted = handle === 'missing.invalid' || handle === 'handle.invalid';
              const isBlocked = convo.muted || false;
              all.push({
                id: convo.id,
                platform: 'bluesky',
                participant: {
                  handle: isDeleted ? 'Deleted account' : handle,
                  displayName: isDeleted ? 'Deleted account' : isBlocked ? `${other?.displayName ?? handle} (blocked)` : other?.displayName,
                  avatar: isDeleted ? undefined : other?.avatar,
                },
                lastMessage: (convo.lastMessage as any)?.text,
                lastDate: (convo.lastMessage as any)?.sentAt,
                unread: (convo.unreadCount ?? 0) > 0,
              });
            }
          } catch (e) {
            console.error('Bluesky OAuth DMs:', e);
            error = (error ? error + '\n' : '') + `Bluesky DMs: ${e}`;
          }
        } else {
          // App passwords can't access DMs
          bskyDmNote = true;
        }
      } else {
        const masto = entry.client as MastodonClient;
        const token = masto.getAccessToken();
        if (!token) continue;
        try {
          const resp = await fetch(`${masto.getInstanceUrl()}/api/v1/conversations?limit=40`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.ok) {
            const raw = await resp.json();
            for (const convo of raw) {
              const other = convo.accounts?.[0];
              all.push({
                id: convo.id,
                platform: 'mastodon',
                participant: {
                  handle: other ? `@${other.acct}` : '?',
                  displayName: other?.display_name,
                  avatar: other?.avatar,
                },
                lastMessage: convo.last_status?.content?.replace(/<[^>]*>?/gm, ''),
                lastDate: convo.last_status?.created_at,
                unread: convo.unread,
              });
            }
          } else {
            error = (error ? error + '\n' : '') + `Mastodon DMs: ${resp.status} ${resp.statusText}`;
          }
        } catch (e) {
          error = (error ? error + '\n' : '') + `Mastodon DMs: ${e}`;
        }
      }
    }

    conversations = all.sort((a, b) =>
      (b.lastDate ? new Date(b.lastDate).getTime() : 0) - (a.lastDate ? new Date(a.lastDate).getTime() : 0)
    );
  }

  async function selectConversation(convo: Conversation) {
    selectedConvo = convo;
    loadingMessages = true;
    messages = [];

    try {
      if (convo.platform === 'bluesky') {
        const oauthSession = await resumeBlueskyOAuthSession();
        if (!oauthSession) {
          messages = [{ id: 'note', text: 'Bluesky DMs require OAuth. Reconnect your account with OAuth in Settings.', sender: { handle: 'system' }, createdAt: new Date().toISOString(), isOurs: false }];
        } else {
          try {
            const proxyHeaders = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
            const msgResp = await (oauthSession.agent as any).api.chat.bsky.convo.getMessages(
              { convoId: convo.id, limit: 50 },
              { headers: proxyHeaders }
            );
            messages = (msgResp.data.messages ?? []).map((m: any) => ({
              id: m.id,
              text: m.text,
              sender: { handle: m.sender?.handle ?? '?', displayName: m.sender?.displayName, avatar: m.sender?.avatar },
              createdAt: m.sentAt,
              isOurs: m.sender?.did === oauthSession.did,
            })).reverse();
          } catch (e) {
            messages = [{ id: 'error', text: `Failed to load messages: ${e}`, sender: { handle: 'system' }, createdAt: new Date().toISOString(), isOurs: false }];
          }
        }
      } else {
        // Mastodon: load all direct messages between us and this person
        for (const [, entry] of clientEntries) {
          if (entry.platform !== 'mastodon') continue;
          const masto = entry.client as MastodonClient;
          const token = masto.getAccessToken();
          if (!token) break;
          try {
            // Search for direct statuses mentioning this user
            const resp = await fetch(
              `${masto.getInstanceUrl()}/api/v1/conversations?limit=40`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (resp.ok) {
              const convos = await resp.json();
              // Find the matching conversation and load its statuses
              const match = convos.find((c: any) =>
                c.accounts?.some((a: any) => `@${a.acct}` === convo.participant.handle || a.acct === convo.participant.handle.replace(/^@/, ''))
              );
              if (match?.last_status) {
                // Get the context (ancestors = earlier messages)
                const ctxResp = await fetch(
                  `${masto.getInstanceUrl()}/api/v1/statuses/${match.last_status.id}/context`,
                  { headers: { Authorization: `Bearer ${token}` } }
                );
                if (ctxResp.ok) {
                  const ctx = await ctxResp.json();
                  const allStatuses = [...(ctx.ancestors ?? []), match.last_status, ...(ctx.descendants ?? [])];
                  const myHandle = accounts.find(a => a.platform === 'mastodon')?.handle ?? '';
                  messages = allStatuses.map((s: any) => ({
                    id: s.id,
                    text: s.content?.replace(/<[^>]*>?/gm, '') ?? '',
                    sender: { handle: `@${s.account.acct}`, displayName: s.account.display_name, avatar: s.account.avatar },
                    createdAt: s.created_at,
                    isOurs: `@${s.account.acct}`.includes(myHandle.replace(/^@/, '').split('@')[0]),
                  }));
                } else {
                  // Fallback: just show last message
                  messages = [{ id: match.last_status.id, text: match.last_status.content?.replace(/<[^>]*>?/gm, '') ?? '', sender: convo.participant, createdAt: match.last_status.created_at, isOurs: false }];
                }
              }
            }
          } catch (e) {
            messages = [{ id: 'error', text: `Failed: ${e}`, sender: { handle: 'system' }, createdAt: new Date().toISOString(), isOurs: false }];
          }
          break;
        }
      }
    } catch (e) {
      error = String(e);
    } finally {
      loadingMessages = false;
    }
  }

  async function sendMessage() {
    if (!newMessage.trim() || !selectedConvo) return;
    sending = true;
    try {
      if (selectedConvo.platform === 'bluesky') {
        const oauthSession = await resumeBlueskyOAuthSession();
        if (!oauthSession) throw new Error('Bluesky DMs require OAuth — reconnect your account with OAuth in Settings');
        const proxyHeaders = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
        await (oauthSession.agent as any).api.chat.bsky.convo.sendMessage(
          { convoId: selectedConvo.id, message: { text: newMessage.trim() } },
          { encoding: 'application/json', headers: proxyHeaders }
        );
      } else {
        // Mastodon: create a status with direct visibility mentioning the user
        for (const [id, entry] of clientEntries) {
          const acct = accounts.find(a => a.id === id);
          if (acct?.platform !== 'mastodon') continue;
          const masto = entry.client as MastodonClient;
          const token = masto.getAccessToken();
          if (!token) continue;
          await fetch(`${masto.getInstanceUrl()}/api/v1/statuses`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: `${selectedConvo.participant.handle} ${newMessage.trim()}`,
              visibility: 'direct',
            }),
          });
          break;
        }
      }

      messages = [...messages, {
        id: `sent-${Date.now()}`,
        text: newMessage.trim(),
        sender: { handle: 'you' },
        createdAt: new Date().toISOString(),
        isOurs: true,
      }];
      newMessage = '';
    } catch (e) {
      error = String(e);
    } finally {
      sending = false;
    }
  }

  async function startNewConversation() {
    if (!newConvoHandle.trim()) return;
    const handle = newConvoHandle.trim();
    // Create a new conversation entry and select it
    const convo: Conversation = {
      id: `new-${Date.now()}`,
      platform: handle.includes('@') ? 'mastodon' : 'bluesky',
      participant: { handle },
      unread: false,
    };
    conversations = [convo, ...conversations];
    selectedConvo = convo;
    messages = [];
    showNewConvo = false;
    newConvoHandle = '';
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
</script>

<svelte:head><title>CrispDeck — Messages</title><meta name="description" content="Direct messages across Mastodon and Bluesky" /></svelte:head>

<div class="h-full flex flex-col">
  <div class="flex items-center gap-2 p-4 border-b border-[var(--color-border)]">
    <MessageSquare size={24} />
    <h1 class="text-xl font-bold">{i18n.t.messages.title}</h1>
  </div>

  {#if error}
    <div class="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}
  {#if bskyDmNote}
    <div class="mx-4 mt-2 p-3 bg-blue-900/30 border border-blue-700/30 rounded-lg text-blue-300 text-xs">
      Bluesky DMs require OAuth login. Reconnect your Bluesky account via OAuth in Settings to enable chat. Mastodon DMs work with any login method.
    </div>
  {/if}

  {#if loading}
    <div class="flex-1 flex items-center justify-center"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin" /></div>
  {:else}
    <div class="flex-1 flex overflow-hidden">
      <!-- Conversation list -->
      <div class="w-80 border-r border-[var(--color-border)] overflow-y-auto flex-shrink-0">
        <!-- New conversation -->
        <div class="p-2 border-b border-[var(--color-border)]">
          {#if showNewConvo}
            <form onsubmit={(e) => { e.preventDefault(); startNewConversation(); }} class="flex gap-1">
              <input type="text" bind:value={newConvoHandle} placeholder="@user or handle..." class="flex-1 px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]" />
              <button type="submit" class="px-2 py-1 text-xs bg-[var(--color-primary)] text-white rounded">Go</button>
            </form>
          {:else}
            <button onclick={() => showNewConvo = true} class="w-full px-3 py-1.5 text-xs text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] rounded transition-colors">
              + New Conversation
            </button>
          {/if}
        </div>

        {#if conversations.length === 0}
          <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">{i18n.t.messages.noConversations}</p>
        {:else}
          {#each conversations as convo}
            <button
              onclick={() => selectConversation(convo)}
              class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)] {selectedConvo?.id === convo.id ? 'bg-[var(--color-surface)]' : ''}"
            >
              {#if convo.participant.avatar}
                <img loading="lazy" src={convo.participant.avatar} alt="" class="w-10 h-10 rounded-full flex-shrink-0" />
              {:else}
                <div class="w-10 h-10 rounded-full bg-[var(--color-surface-hover)] flex-shrink-0"></div>
              {/if}
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium truncate">{convo.participant.displayName || convo.participant.handle}</span>
                  <div class="flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full" style="background: var(--color-{convo.platform})"></span>
                    {#if convo.lastDate}<span class="text-[10px] text-[var(--color-text-muted)]">{formatTime(convo.lastDate)}</span>{/if}
                  </div>
                </div>
                {#if convo.lastMessage}
                  <p class="text-xs text-[var(--color-text-muted)] truncate {convo.unread ? 'font-semibold text-[var(--color-text)]' : ''}">{convo.lastMessage}</p>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>

      <!-- Message thread -->
      <div class="flex-1 flex flex-col">
        {#if selectedConvo}
          <!-- Header -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            {#if selectedConvo.participant.avatar}
              <img loading="lazy" src={selectedConvo.participant.avatar} alt="" class="w-8 h-8 rounded-full" />
            {/if}
            <div>
              <p class="text-sm font-medium">{selectedConvo.participant.displayName || selectedConvo.participant.handle}</p>
              <p class="text-xs text-[var(--color-text-muted)]">{selectedConvo.participant.handle}</p>
            </div>
          </div>

          <!-- Messages -->
          <div class="flex-1 overflow-y-auto p-4 space-y-3">
            {#if loadingMessages}
              <div class="text-center py-4"><Loader2 size={20} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
            {:else}
              {#each messages as msg}
                <div class="flex {msg.isOurs ? 'justify-end' : 'justify-start'}">
                  <div class="max-w-[70%] px-3 py-2 rounded-lg text-sm {msg.isOurs ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] border border-[var(--color-border)]'}">
                    <p>{msg.text}</p>
                    <p class="text-[10px] mt-1 {msg.isOurs ? 'text-white/60' : 'text-[var(--color-text-muted)]'}">{formatTime(msg.createdAt)}</p>
                  </div>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Compose -->
          <form onsubmit={(e) => { e.preventDefault(); sendMessage(); }} class="p-3 border-t border-[var(--color-border)] flex gap-2">
            <input
              type="text"
              bind:value={newMessage}
              placeholder={i18n.t.messages.typePlaceholder}
              class="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            />
            <button type="submit" disabled={sending || !newMessage.trim()} class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-50">
              {#if sending}<Loader2 size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
            </button>
          </form>
        {:else}
          <div class="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
            <p class="text-sm">{i18n.t.messages.selectConversation}</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
