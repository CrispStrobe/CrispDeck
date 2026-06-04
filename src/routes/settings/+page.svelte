<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listAccounts, addAccount as dbAddAccount, deleteAccount as dbDeleteAccount,
    updateAccount as dbUpdateAccount, startMastodonOAuth as dbStartOAuth,
    completeMastodonOAuth as dbCompleteOAuth
  } from '$lib/db';
  import { Settings, Plus, Trash2, Star, ExternalLink, Loader2, Shield } from '@lucide/svelte';
  import { startBlueskyOAuth } from '$lib/api/bluesky-oauth';
  import { i18n, type Language } from '$lib/i18n.svelte';
  import { getTranslateConfig, setTranslateConfig, type TranslateProvider } from '$lib/translate';
  import type { Account } from '$lib/types';

  let uiLanguage = $state<Language>(i18n.lang);

  // Translation config
  const txConfig = getTranslateConfig();
  let translateProvider = $state<TranslateProvider>(txConfig.provider);
  let translateLang = $state(txConfig.targetLang);
  let openaiBaseUrl = $state(txConfig.openaiBaseUrl ?? 'https://api.openai.com/v1');
  let openaiApiKey = $state(txConfig.openaiApiKey ?? '');
  let openaiModel = $state(txConfig.openaiModel ?? 'gpt-4o-mini');
  let crispasrModel = $state(txConfig.crispasrModel ?? 'm2m100-418m-q4_k');

  let altTextMode = $state<'off' | 'warn' | 'require'>(
    (localStorage.getItem('crispdeck-alt-text-mode') as any) ?? 'off'
  );

  function handleLanguageChange() {
    i18n.setLanguage(uiLanguage);
  }

  function saveTranslateConfig() {
    setTranslateConfig({
      provider: translateProvider,
      targetLang: translateLang,
      openaiBaseUrl: openaiBaseUrl || undefined,
      openaiApiKey: openaiApiKey || undefined,
      openaiModel: openaiModel || undefined,
      crispasrModel: crispasrModel || undefined,
    });
  }

  function handleAltTextModeChange() {
    localStorage.setItem('crispdeck-alt-text-mode', altTextMode);
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  // Add Bluesky form
  let showBskyForm = $state(false);
  let bskyAuthMode: 'app-password' | 'oauth' = $state('oauth');
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

  async function connectBlueskyOAuth() {
    if (!bskyHandle.trim()) return;
    bskyLoading = true;
    error = '';
    try {
      const handle = bskyHandle.trim().replace(/^@/, '');
      await startBlueskyOAuth(handle);
      // This redirects — execution stops here
    } catch (e) {
      error = String(e);
      bskyLoading = false;
    }
  }

  async function addBlueskyAccount() {
    if (!bskyHandle.trim() || !bskyAppPassword.trim()) return;
    bskyLoading = true;
    error = '';
    try {
      const credentials = JSON.stringify({ app_password: bskyAppPassword });
      const handle = bskyHandle.trim().replace(/^@/, '');

      // Verify credentials + fetch profile
      const { BlueskyClient } = await import('$lib/api/bluesky');
      const testClient = new BlueskyClient(handle, bskyAppPassword);
      await testClient.login();
      const profile = await testClient.getProfile(handle);

      await dbAddAccount({
        platform: 'bluesky',
        handle: profile.handle ?? handle,
        display_name: profile.displayName,
        avatar_url: profile.avatar,
        did: profile.did,
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

      // Store OAuth state so the callback page can complete the flow
      localStorage.setItem('crispdeck-oauth-state', JSON.stringify({
        instance_url: instanceUrl,
        client_id: mastoOAuthState!.client_id,
        client_secret: mastoOAuthState!.client_secret,
        redirect_uri: mastoOAuthState!.redirect_uri,
      }));

      // Redirect to the Mastodon authorization page
      // The callback at /oauth/callback will complete the flow
      window.location.href = mastoOAuthState!.auth_url;
      return; // Page will unload
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
          <!-- Auth mode toggle -->
          <div class="flex items-center bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] p-0.5">
            <button
              onclick={() => bskyAuthMode = 'oauth'}
              class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {bskyAuthMode === 'oauth' ? 'bg-[var(--color-bluesky)] text-white' : 'text-[var(--color-text-muted)]'}"
            >
              <Shield size={12} />
              OAuth (recommended)
            </button>
            <button
              onclick={() => bskyAuthMode = 'app-password'}
              class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {bskyAuthMode === 'app-password' ? 'bg-[var(--color-bluesky)] text-white' : 'text-[var(--color-text-muted)]'}"
            >
              App Password
            </button>
          </div>

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

          {#if bskyAuthMode === 'oauth'}
            <p class="text-xs text-[var(--color-text-muted)]">
              OAuth gives full access including DMs. You'll be redirected to Bluesky to authorize.
            </p>
            <div class="flex gap-2">
              <button
                onclick={connectBlueskyOAuth}
                disabled={bskyLoading || !bskyHandle.trim()}
                class="flex items-center gap-1 px-4 py-2 bg-[var(--color-bluesky)] hover:opacity-90 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {#if bskyLoading}<Loader2 size={14} class="animate-spin" />{/if}
                <Shield size={14} />
                Connect with OAuth
              </button>
              <button onclick={() => showBskyForm = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
            </div>
          {:else}
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
                App passwords don't support DMs. Generate at Settings → App Passwords on bsky.app
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
          {/if}
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
                <span class="text-sm font-medium">{account.display_name || account.handle}</span>
                {#if account.handle.startsWith('@user@') || account.handle === '@user'}
                  <span class="ml-2 text-xs text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">setup incomplete — delete and re-add</span>
                {:else}
                  <span class="text-xs text-[var(--color-text-muted)] ml-1">{account.handle}</span>
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

  <!-- Preferences -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.preferences}</h2>
    <div class="space-y-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <!-- UI Language -->
      <div class="flex items-center justify-between">
        <label for="ui-lang" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.language}</label>
        <select
          id="ui-lang"
          bind:value={uiLanguage}
          onchange={handleLanguageChange}
          class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      <!-- Alt text enforcement -->
      <div class="flex items-center justify-between">
        <label for="alt-text-mode" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.altTextMode}</label>
        <select
          id="alt-text-mode"
          bind:value={altTextMode}
          onchange={handleAltTextModeChange}
          class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none"
        >
          <option value="off">{i18n.t.settings.altTextOff}</option>
          <option value="warn">{i18n.t.settings.altTextWarn}</option>
          <option value="require">{i18n.t.settings.altTextRequire}</option>
        </select>
      </div>
    </div>
  </section>

  <!-- Translation -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.translateTarget}</h2>
    <div class="space-y-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <!-- Provider -->
      <div>
        <label class="block text-sm text-[var(--color-text-muted)] mb-2">Translation provider</label>
        <div class="flex items-center bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            onclick={() => { translateProvider = 'mymemory'; saveTranslateConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {translateProvider === 'mymemory' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            MyMemory (free)
          </button>
          <button
            onclick={() => { translateProvider = 'crispasr'; saveTranslateConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {translateProvider === 'crispasr' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            CrispASR (local)
          </button>
          <button
            onclick={() => { translateProvider = 'openai'; saveTranslateConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {translateProvider === 'openai' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            OpenAI / BYOK
          </button>
        </div>
      </div>

      <!-- Target language -->
      <div class="flex items-center justify-between">
        <label for="translate-lang" class="text-sm text-[var(--color-text-muted)]">Target language</label>
        <select
          id="translate-lang"
          bind:value={translateLang}
          onchange={saveTranslateConfig}
          class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none"
        >
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="ja">日本語</option>
          <option value="pt">Português</option>
          <option value="zh">中文</option>
          <option value="ko">한국어</option>
          <option value="it">Italiano</option>
          <option value="nl">Nederlands</option>
          <option value="ru">Русский</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <!-- Provider-specific config -->
      {#if translateProvider === 'mymemory'}
        <p class="text-xs text-[var(--color-text-muted)]">
          Free API, no key needed. 5000 chars/day limit. Auto-detects source language.
        </p>
      {/if}

      {#if translateProvider === 'crispasr'}
        <div class="space-y-2">
          <p class="text-xs text-[var(--color-text-muted)]">
            Local translation via CrispASR with M2M-100 GGUF models. Runs natively on CPU/GPU — no API key, fully offline. Model downloaded on first use. Requires desktop app.
          </p>
          <div>
            <label for="crispasr-model" class="block text-xs text-[var(--color-text-muted)] mb-1">Model</label>
            <select
              id="crispasr-model"
              bind:value={crispasrModel}
              onchange={saveTranslateConfig}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            >
              <option value="m2m100-418m-q4_k">M2M-100 418M Q4_K · 271 MB · 100 languages</option>
              <option value="m2m100-418m-q8_0">M2M-100 418M Q8_0 · 502 MB · 100 languages</option>
              <option value="m2m100-418m-f16">M2M-100 418M F16 · 934 MB · 100 languages</option>
            </select>
          </div>
          <p class="text-[10px] text-[var(--color-text-muted)]">
            Same models as CrisperWeaver. Coming soon for desktop builds — use BYOK or MyMemory for now.
          </p>
        </div>
      {/if}

      {#if translateProvider === 'openai'}
        <div class="space-y-3">
          <p class="text-xs text-[var(--color-text-muted)]">
            Bring your own key. Works with OpenAI, Mistral, Groq, Ollama, llama.cpp, or any OpenAI-compatible endpoint.
          </p>
          <div>
            <label for="openai-base" class="block text-xs text-[var(--color-text-muted)] mb-1">API Base URL</label>
            <input
              id="openai-base"
              type="text"
              bind:value={openaiBaseUrl}
              onchange={saveTranslateConfig}
              placeholder="https://api.openai.com/v1"
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            />
          </div>
          <div>
            <label for="openai-key" class="block text-xs text-[var(--color-text-muted)] mb-1">API Key</label>
            <input
              id="openai-key"
              type="password"
              bind:value={openaiApiKey}
              onchange={saveTranslateConfig}
              placeholder="sk-..."
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            />
          </div>
          <div>
            <label for="openai-model" class="block text-xs text-[var(--color-text-muted)] mb-1">Model</label>
            <input
              id="openai-model"
              type="text"
              bind:value={openaiModel}
              onchange={saveTranslateConfig}
              placeholder="gpt-4o-mini"
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            />
            <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
              For Ollama: base URL = http://localhost:11434/v1, model = llama3.2, no key needed.
            </p>
          </div>
        </div>
      {/if}
    </div>
  </section>
</div>
