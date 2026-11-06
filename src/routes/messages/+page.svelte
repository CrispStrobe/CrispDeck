<script lang="ts">
  import { onMount } from 'svelte';
  import { swallow } from '$lib/debug-log';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { MessageSquare, Loader2, Send, ArrowLeft } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import type { Account } from '$lib/types';
  import {
    formatConversationTime, conversationKey, findLinkedConversation, sortByRecent,
    loadConversationInbox, loadConversationMessages, sendConversationMessage,
    createConversation, messageErrorMessage, type Conversation, type Message,
  } from '$lib/messages';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let inboxError = $state('');
  let conversations: Conversation[] = $state([]);
  let selectedConvo: Conversation | null = $state(null);
  let messages: Message[] = $state([]);
  let loadingMessages = $state(false);
  let newMessage = $state('');
  let sending = $state(false);
  let starting = $state(false);
  let showNewConvo = $state(false);
  let newConvoHandle = $state('');
  let newConvoAccountId = $state<number | undefined>();
  let messagesContainer: HTMLDivElement | undefined = $state();
  let clientEntries: Map<number, ClientEntry> = new Map();
  const drafts = new Map<string, string>();
  let selectionVersion = 0;
  let disposed = false;
  const chatAccounts = $derived(accounts.filter(account => account.platform === 'bluesky' || account.platform === 'mastodon'));

  function scrollToLatest() {
    requestAnimationFrame(() => {
      if (!disposed && messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  function accountLabel(conversation: Conversation): string {
    return accounts.find(account => account.id === conversation.accountId)?.handle ?? 'Disconnected account';
  }

  onMount(() => {
    void initialize();
    return () => { disposed = true; selectionVersion++; };
  });

  async function initialize() {
    try {
      const result = await initAllClients();
      if (disposed) return;
      accounts = result.accounts;
      clientEntries = result.clients;
      newConvoAccountId = chatAccounts.find(account => account.is_primary)?.id ?? chatAccounts[0]?.id;
      const inbox = await loadConversationInbox(accounts, clientEntries);
      if (disposed) return;
      conversations = inbox.conversations;
      inboxError = inbox.errors.map(item => `${accounts.find(account => account.id === item.accountId)?.handle ?? item.accountId}: ${item.message}`).join('\n');
      const params = new URLSearchParams(window.location.search);
      if (params.has('conversation')) {
        const linked = findLinkedConversation(conversations, params);
        if (linked) await selectConversation(linked);
        else error = 'This conversation is not available for the selected account. Refresh your inbox or reconnect that account in Settings.';
      }
    } catch (cause) {
      if (!disposed) error = messageErrorMessage(cause);
    } finally {
      if (!disposed) loading = false;
    }
  }

  function updateConversation(updated: Conversation) {
    const key = conversationKey(updated);
    conversations = sortByRecent(conversations.map(conversation => conversationKey(conversation) === key ? updated : conversation));
    if (selectedConvo && conversationKey(selectedConvo) === key) selectedConvo = updated;
  }

  async function selectConversation(conversation: Conversation) {
    if (selectedConvo) drafts.set(conversationKey(selectedConvo), newMessage);
    const version = ++selectionVersion;
    selectedConvo = conversation;
    newMessage = drafts.get(conversationKey(conversation)) ?? '';
    messages = [];
    loadingMessages = true;
    error = '';
    try {
      const loaded = await loadConversationMessages(conversation, accounts, clientEntries);
      // A slow response from a previously selected account must never replace
      // the thread the reader has since selected.
      if (disposed || version !== selectionVersion) return;
      messages = loaded;
      updateConversation({
        ...conversation, unread: false,
        ...(conversation.platform === 'mastodon' && loaded.length ? { lastStatusId: loaded[loaded.length - 1].id } : {}),
      });
    } catch (cause) {
      if (!disposed && version === selectionVersion) error = messageErrorMessage(cause, clientEntries.get(conversation.accountId!));
    } finally {
      if (!disposed && version === selectionVersion) {
        loadingMessages = false;
        scrollToLatest();
      }
    }
  }

  function showConversationList() {
    if (selectedConvo) drafts.set(conversationKey(selectedConvo), newMessage);
    selectionVersion++;
    selectedConvo = null;
    messages = [];
    newMessage = '';
    loadingMessages = false;
  }

  async function sendMessage() {
    if (sending || loadingMessages || !newMessage.trim() || !selectedConvo) return;
    const conversation = selectedConvo;
    const key = conversationKey(conversation);
    const text = newMessage;
    drafts.set(key, text);
    sending = true;
    error = '';
    try {
      const sent = await sendConversationMessage(conversation, text, accounts, clientEntries);
      if (disposed) return;
      const current = conversations.find(candidate => conversationKey(candidate) === key) ?? conversation;
      updateConversation({ ...current, lastMessage: sent.text, lastDate: sent.createdAt, unread: false, isNew: false,
        ...(conversation.platform === 'mastodon' ? { lastStatusId: sent.id } : {}),
      });
      if (selectedConvo && conversationKey(selectedConvo) === key) {
        messages = [...messages.filter(message => message.id !== sent.id), sent];
        if (newMessage === text) newMessage = '';
        scrollToLatest();
      }
      if (drafts.get(key) === text) drafts.delete(key);
    } catch (cause) {
      const message = messageErrorMessage(cause, clientEntries.get(conversation.accountId!));
      swallow('messages.sendMessage', new Error(message));
      if (!disposed) error = `${accountLabel(conversation)}: ${message}`;
    } finally {
      if (!disposed) sending = false;
    }
  }

  async function startNewConversation() {
    if (starting || !newConvoHandle.trim() || newConvoAccountId === undefined) return;
    starting = true;
    error = '';
    try {
      const conversation = await createConversation(newConvoAccountId, newConvoHandle, accounts, clientEntries);
      if (disposed) return;
      const key = conversationKey(conversation);
      conversations = [conversation, ...conversations.filter(candidate => conversationKey(candidate) !== key)];
      showNewConvo = false;
      newConvoHandle = '';
      await selectConversation(conversation);
    } catch (cause) {
      if (!disposed) error = messageErrorMessage(cause, clientEntries.get(newConvoAccountId));
    } finally {
      if (!disposed) starting = false;
    }
  }

  const formatTime = (dateStr: string) => formatConversationTime(dateStr);
</script>

<svelte:head><title>CrispDeck — Messages</title><meta name="description" content="Direct messages across Mastodon and Bluesky" /></svelte:head>

<div class="h-full flex flex-col">
  <div class="flex items-center gap-2 p-4 border-b border-[var(--color-border)]">
    <MessageSquare size={24} />
    <h1 class="text-xl font-bold">{i18n.t.messages.title}</h1>
  </div>

  {#if error || inboxError}
    <div role="alert" class="mx-4 mt-2 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm whitespace-pre-line">{[inboxError, error].filter(Boolean).join('\n')}</div>
  {/if}

  {#if loading}
    <div class="flex-1 flex items-center justify-center"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin" /></div>
  {:else}
    <div class="flex-1 flex overflow-hidden">
      <!-- Conversation list -->
      <div class="w-full md:w-80 border-r border-[var(--color-border)] overflow-y-auto flex-shrink-0 {selectedConvo ? 'hidden md:block' : ''}">
        <!-- New conversation -->
        <div class="p-2 border-b border-[var(--color-border)]">
          {#if showNewConvo}
            <form onsubmit={(e) => { e.preventDefault(); startNewConversation(); }} class="flex flex-col gap-2">
              <label class="text-xs text-[var(--color-text-muted)]">
                {i18n.t.settings.tabAccount}
                <select bind:value={newConvoAccountId} disabled={starting} class="w-full mt-1 px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]">
                  {#each chatAccounts as account (account.id)}<option value={account.id}>{account.handle} · {account.platform}</option>{/each}
                </select>
              </label>
              <div class="flex gap-1">
                <input type="text" bind:value={newConvoHandle} aria-label={i18n.t.messages.userOrHandle} disabled={starting} placeholder={i18n.t.messages.userOrHandle} class="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)]" />
                <button type="submit" disabled={starting || !newConvoHandle.trim() || newConvoAccountId === undefined} class="px-2 py-1 text-xs bg-[var(--color-primary)] text-white rounded disabled:opacity-50">{starting ? i18n.t.common.loading : i18n.t.messages.go}</button>
              </div>
            </form>
          {:else}
            <button onclick={() => showNewConvo = true} disabled={!chatAccounts.length} class="w-full px-3 py-1.5 text-xs text-[var(--color-primary-text)] hover:bg-[var(--color-surface-hover)] rounded transition-colors disabled:opacity-50">
              {i18n.t.messages.newConversation}
            </button>
          {/if}
        </div>

        {#if conversations.length === 0}
          <p class="text-center py-8 text-sm text-[var(--color-text-muted)]">{i18n.t.messages.noConversations}</p>
        {:else}
          {#each conversations as convo (conversationKey(convo))}
            <button
              onclick={() => selectConversation(convo)}
              aria-pressed={selectedConvo !== null && conversationKey(selectedConvo) === conversationKey(convo)}
              class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)] {selectedConvo && conversationKey(selectedConvo) === conversationKey(convo) ? 'bg-[var(--color-surface)]' : ''}"
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
                <p class="text-[10px] text-[var(--color-text-muted)] truncate">{accountLabel(convo)}</p>
              </div>
            </button>
          {/each}
        {/if}
      </div>

      <!-- Message thread -->
      <div class="flex-1 min-w-0 flex-col {selectedConvo ? 'flex' : 'hidden md:flex'}">
        {#if selectedConvo}
          <!-- Header -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
            <button type="button" onclick={showConversationList} aria-label={i18n.t.onboarding.back} class="md:hidden p-1 text-[var(--color-text-muted)]"><ArrowLeft size={20} /></button>
            {#if selectedConvo.participant.avatar}
              <img loading="lazy" src={selectedConvo.participant.avatar} alt="" class="w-8 h-8 rounded-full" />
            {/if}
            <div>
              <p class="text-sm font-medium">{selectedConvo.participant.displayName || selectedConvo.participant.handle}</p>
              <p class="text-xs text-[var(--color-text-muted)]">{selectedConvo.participant.handle}</p>
              <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.settings.tabAccount}: {accountLabel(selectedConvo)}</p>
            </div>
          </div>

          <!-- Messages -->
          <div bind:this={messagesContainer} role="log" aria-label={i18n.t.messages.title} aria-live="polite" aria-busy={loadingMessages} class="flex-1 overflow-y-auto p-4 space-y-3">
            {#if loadingMessages}
              <div class="text-center py-4"><Loader2 size={20} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
            {:else}
              {#each messages as msg (msg.id)}
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
              aria-label={i18n.t.messages.typePlaceholder}
              disabled={sending || loadingMessages}
              placeholder={i18n.t.messages.typePlaceholder}
              class="flex-1 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
            />
            <button type="submit" aria-label={i18n.t.messages.sendMessage} disabled={sending || loadingMessages || !newMessage.trim()} class="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg disabled:opacity-50">
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
