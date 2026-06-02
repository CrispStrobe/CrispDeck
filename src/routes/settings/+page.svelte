<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listAccounts, addAccount as dbAddAccount, deleteAccount as dbDeleteAccount,
    updateAccount as dbUpdateAccount, startMastodonOAuth as dbStartOAuth,
    completeMastodonOAuth as dbCompleteOAuth
  } from '$lib/db';
  import { Settings, Plus, Trash2, Star, ExternalLink, Loader2 } from '@lucide/svelte';
  import type { Account } from '$lib/types';

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  // Add Bluesky form
  let showBskyForm = $state(false);
  let bskyHandle = $state('');
  let bskyAppPassword = $state('');
  let bskyLoading = $state(false);

  // Add Mastodon form
  let showMastoForm = $state(false);
  let mastoInstance = $state('');
  let mastoLoading = $state(false);
  let mastoOAuthState: {
    auth_url: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
  } | null = $state(null);

  onMount(loadAccounts);

  async function loadAccounts() {
    try {
      accounts = await listAccounts();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function addBlueskyAccount() {
    if (!bskyHandle.trim() || !bskyAppPassword.trim()) return;
    bskyLoading = true;
    error = '';
    try {
      const credentials = JSON.stringify({ app_password: bskyAppPassword });
      const handle = bskyHandle.trim().replace(/^@/, '');

      await dbAddAccount({
        platform: 'bluesky',
        handle,
        credentials,
        is_primary: accounts.filter(a => a.platform === 'bluesky').length === 0,
      });

      bskyHandle = '';
      bskyAppPassword = '';
      showBskyForm = false;
      await loadAccounts();
    } catch (e) {
      error = String(e);
    } finally {
      bskyLoading = false;
    }
  }

  async function handleStartMastodonOAuth() {
    if (!mastoInstance.trim()) return;
    mastoLoading = true;
    error = '';
    try {
      const instance = mastoInstance.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const instanceUrl = `https://${instance}`;

      mastoOAuthState = await dbStartOAuth(instanceUrl);

      // Open the auth URL in the user's browser
      window.open(mastoOAuthState!.auth_url);

      // The OAuth callback comes via URL redirect in browser mode.
      // In Tauri, the redirect_uri points to localhost and the app intercepts it.
      // For now, we need the user to paste the code or handle the redirect.
      // TODO: implement redirect-based callback handling
      const code = new URLSearchParams(window.location.search).get('code') ?? '';

      // Exchange code for token
      const result = await dbCompleteOAuth({
        instance_url: instanceUrl,
        code,
        client_id: mastoOAuthState!.client_id,
        client_secret: mastoOAuthState!.client_secret,
        redirect_uri: mastoOAuthState!.redirect_uri,
      });

      // Store the account
      const credentials = JSON.stringify({
        access_token: result.access_token,
        client_id: mastoOAuthState!.client_id,
        client_secret: mastoOAuthState!.client_secret,
      });

      await dbAddAccount({
        platform: 'mastodon',
        handle: `@user@${instance}`, // Will be updated when we fetch profile
        instance_url: instanceUrl,
        credentials,
        is_primary: accounts.filter(a => a.platform === 'mastodon').length === 0,
      });

      mastoInstance = '';
      showMastoForm = false;
      mastoOAuthState = null;
      await loadAccounts();
    } catch (e) {
      error = String(e);
    } finally {
      mastoLoading = false;
    }
  }

  async function removeAccount(id: number) {
    try {
      await dbDeleteAccount(id);
      await loadAccounts();
    } catch (e) {
      error = String(e);
    }
  }

  async function setPrimary(id: number) {
    try {
      await dbUpdateAccount({ id, is_primary: true });
      await loadAccounts();
    } catch (e) {
      error = String(e);
    }
  }

  const bskyAccounts = $derived(accounts.filter(a => a.platform === 'bluesky'));
  const mastoAccounts = $derived(accounts.filter(a => a.platform === 'mastodon'));
</script>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Settings size={24} />
    <h1 class="text-2xl font-bold">Settings</h1>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
      {error}
      <button onclick={() => error = ''} class="ml-2 underline">dismiss</button>
    </div>
  {/if}

  <!-- Bluesky Accounts -->
  <section class="mb-8">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-[var(--color-bluesky)]"></div>
        Bluesky Accounts
      </h2>
      <button
        onclick={() => showBskyForm = !showBskyForm}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-bluesky)] hover:opacity-90 rounded-md transition-opacity"
      >
        <Plus size={14} />
        Add
      </button>
    </div>

    {#if showBskyForm}
      <div class="mb-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <div class="space-y-3">
          <div>
            <label for="bsky-handle" class="block text-sm text-[var(--color-text-muted)] mb-1">Handle</label>
            <input
              id="bsky-handle"
              type="text"
              bind:value={bskyHandle}
              placeholder="your-handle.bsky.social"
              class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]"
            />
          </div>
          <div>
            <label for="bsky-password" class="block text-sm text-[var(--color-text-muted)] mb-1">App Password</label>
            <input
              id="bsky-password"
              type="password"
              bind:value={bskyAppPassword}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-bluesky)]"
            />
            <p class="mt-1 text-xs text-[var(--color-text-muted)]">
              Generate at Settings → App Passwords on bsky.app
            </p>
          </div>
          <div class="flex gap-2">
            <button
              onclick={addBlueskyAccount}
              disabled={bskyLoading}
              class="flex items-center gap-1 px-4 py-2 bg-[var(--color-bluesky)] hover:opacity-90 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {#if bskyLoading}<Loader2 size={14} class="animate-spin" />{/if}
              Add Account
            </button>
            <button
              onclick={() => showBskyForm = false}
              class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if bskyAccounts.length === 0}
      <p class="text-sm text-[var(--color-text-muted)] p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        No Bluesky accounts connected.
      </p>
    {:else}
      <div class="space-y-2">
        {#each bskyAccounts as account}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              {#if account.avatar_url}
                <img src={account.avatar_url} alt="" class="w-8 h-8 rounded-full" />
              {:else}
                <div class="w-8 h-8 rounded-full bg-[var(--color-bluesky)]/20 flex items-center justify-center text-xs">BS</div>
              {/if}
              <div>
                <span class="text-sm font-medium">{account.handle}</span>
                {#if account.is_primary}
                  <span class="ml-2 text-xs text-yellow-400">★ primary</span>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-1">
              {#if !account.is_primary}
                <button onclick={() => setPrimary(account.id)} title="Set as primary" class="p-1.5 text-[var(--color-text-muted)] hover:text-yellow-400 transition-colors">
                  <Star size={14} />
                </button>
              {/if}
              <button onclick={() => removeAccount(account.id)} title="Remove account" class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Mastodon Accounts -->
  <section class="mb-8">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-[var(--color-mastodon)]"></div>
        Mastodon Accounts
      </h2>
      <button
        onclick={() => showMastoForm = !showMastoForm}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-mastodon)] hover:opacity-90 rounded-md transition-opacity"
      >
        <Plus size={14} />
        Add
      </button>
    </div>

    {#if showMastoForm}
      <div class="mb-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <div class="space-y-3">
          <div>
            <label for="masto-instance" class="block text-sm text-[var(--color-text-muted)] mb-1">Instance</label>
            <input
              id="masto-instance"
              type="text"
              bind:value={mastoInstance}
              placeholder="mastodon.social"
              class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-mastodon)]"
            />
          </div>
          <div class="flex gap-2">
            <button
              onclick={handleStartMastodonOAuth}
              disabled={mastoLoading}
              class="flex items-center gap-1 px-4 py-2 bg-[var(--color-mastodon)] hover:opacity-90 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {#if mastoLoading}<Loader2 size={14} class="animate-spin" />{/if}
              {#if mastoOAuthState}
                Waiting for authorization...
              {:else}
                Authorize with OAuth
              {/if}
            </button>
            <button
              onclick={() => { showMastoForm = false; mastoOAuthState = null; }}
              class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          </div>
          {#if mastoOAuthState}
            <p class="text-xs text-[var(--color-text-muted)]">
              A browser window should open. Authorize the app, then return here.
            </p>
          {/if}
        </div>
      </div>
    {/if}

    {#if mastoAccounts.length === 0}
      <p class="text-sm text-[var(--color-text-muted)] p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        No Mastodon accounts connected.
      </p>
    {:else}
      <div class="space-y-2">
        {#each mastoAccounts as account}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              {#if account.avatar_url}
                <img src={account.avatar_url} alt="" class="w-8 h-8 rounded-full" />
              {:else}
                <div class="w-8 h-8 rounded-full bg-[var(--color-mastodon)]/20 flex items-center justify-center text-xs">M</div>
              {/if}
              <div>
                <span class="text-sm font-medium">{account.handle}</span>
                {#if account.instance_url}
                  <span class="text-xs text-[var(--color-text-muted)] ml-1">({account.instance_url})</span>
                {/if}
                {#if account.is_primary}
                  <span class="ml-2 text-xs text-yellow-400">★ primary</span>
                {/if}
              </div>
            </div>
            <div class="flex items-center gap-1">
              {#if !account.is_primary}
                <button onclick={() => setPrimary(account.id)} title="Set as primary" class="p-1.5 text-[var(--color-text-muted)] hover:text-yellow-400 transition-colors">
                  <Star size={14} />
                </button>
              {/if}
              <button onclick={() => removeAccount(account.id)} title="Remove account" class="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
