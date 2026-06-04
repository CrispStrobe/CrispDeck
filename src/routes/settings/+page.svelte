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
  let crispasrModel = $state(txConfig.crispasrModel ?? 'm2m100');

  // TTS + STT model + engine settings (stored in localStorage)
  let ttsModel = $state(localStorage.getItem('crispdeck-tts-model') ?? 'kokoro');
  let sttModel = $state(localStorage.getItem('crispdeck-stt-model') ?? 'whisper');
  let ttsEngine = $state<'auto' | 'crispasr' | 'browser'>(
    (localStorage.getItem('crispdeck-tts-engine') as any) ?? 'auto'
  );
  let sttEngine = $state<'auto' | 'crispasr' | 'browser'>(
    (localStorage.getItem('crispdeck-stt-engine') as any) ?? 'auto'
  );
  function saveTtsModel() { localStorage.setItem('crispdeck-tts-model', ttsModel); }
  function saveSttModel() { localStorage.setItem('crispdeck-stt-model', sttModel); }
  function saveTtsEngine() { localStorage.setItem('crispdeck-tts-engine', ttsEngine); }
  function saveSttEngine() { localStorage.setItem('crispdeck-stt-engine', sttEngine); }

  // Model manager
  let isTauri = $state(false);
  let crispasrAvailable = $state(false);
  let registryModels: Array<{ name: string; filename: string; approx_size: string; url: string }> = $state([]);

  onMount(async () => {
    // ... existing onMount runs loadAccounts
    // Check Tauri + CrispASR availability
    if (typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined') {
      isTauri = true;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        crispasrAvailable = await invoke('asr_available') as boolean;
      } catch {}
    }
  });

  async function loadRegistry() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      registryModels = await invoke('asr_list_models') as typeof registryModels;
    } catch (e) {
      error = `Failed to load registry: ${e}`;
    }
  }

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
          <option value="fr">Français</option>
          <option value="es">Español</option>
          <option value="ja">日本語</option>
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
            Local translation via CrispASR GGUF models. Runs natively on CPU/GPU — no API key, fully offline. Model auto-downloaded on first use. Requires desktop app built with <code class="bg-[var(--color-bg)] px-1 rounded text-[10px]">--features crispasr-metal</code>.
          </p>
          <div>
            <label for="crispasr-model" class="block text-xs text-[var(--color-text-muted)] mb-1">Translation model</label>
            <select
              id="crispasr-model"
              bind:value={crispasrModel}
              onchange={saveTranslateConfig}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            >
              <optgroup label="M2M-100 (100 languages, any-to-any)">
                <option value="m2m100">M2M-100 418M Q8 · ~502 MB</option>
              </optgroup>
              <optgroup label="WMT21 Dense (EN ↔ 7 langs, higher quality)">
                <option value="m2m100-wmt21">WMT21 Dense 24-wide Q4 · ~2.5 GB</option>
              </optgroup>
              <optgroup label="MADLAD-400 (419 languages)">
                <option value="madlad">MADLAD-400 3B Q4 · ~1.9 GB</option>
              </optgroup>
              <optgroup label="Gemma4 E2B (140+ langs, dual ASR+MT)">
                <option value="gemma4-e2b">Gemma4 E2B Q4 · ~2.5 GB</option>
              </optgroup>
            </select>
          </div>
          <p class="text-[10px] text-[var(--color-text-muted)]">
            M2M-100 is recommended for most use cases. WMT21 is higher quality for EN↔{zh,de,fr,ja,ru,is,ha}. MADLAD covers 419 languages. All models are commercially licensed (MIT / Apache-2.0).
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

  <!-- Text-to-Speech -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Text-to-Speech (Read Aloud)</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div class="flex items-center justify-between">
        <label for="tts-engine" class="text-xs text-[var(--color-text-muted)]">{i18n.t.tts.engine}</label>
        <select id="tts-engine" bind:value={ttsEngine} onchange={saveTtsEngine} class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none">
          <option value="auto">{i18n.t.tts.engineAuto}</option>
          <option value="crispasr">{i18n.t.tts.engineCrispasr}</option>
          <option value="browser">{i18n.t.tts.engineBrowser}</option>
        </select>
      </div>
      {#if ttsEngine !== 'browser'}
      <div>
        <label for="tts-model" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.tts.model}</label>
        <select id="tts-model" bind:value={ttsModel} onchange={saveTtsModel} class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none">
          <optgroup label="Lightweight (fast)">
            <option value="kokoro">Kokoro 82M Q8 · ~135 MB · English</option>
            <option value="piper">Piper (Lessac) · ~16 MB · English</option>
            <option value="pocket-tts">Pocket TTS · ~220 MB · English</option>
            <option value="fastpitch">FastPitch · ~120 MB · English</option>
          </optgroup>
          <optgroup label="High quality">
            <option value="qwen3-tts">Qwen3 TTS 0.6B Q8 · ~986 MB</option>
            <option value="qwen3-tts-1.7b-base">Qwen3 TTS 1.7B Q8 · ~1.9 GB</option>
            <option value="chatterbox">Chatterbox Q8 · ~880 MB</option>
            <option value="chatterbox-turbo">Chatterbox Turbo Q8 · ~980 MB</option>
            <option value="vibevoice-tts">VibeVoice 0.5B Q4 · ~636 MB</option>
            <option value="orpheus">Orpheus 3B Q8 · ~3.5 GB</option>
          </optgroup>
          <optgroup label="German voices">
            <option value="kartoffel-orpheus-de-natural">Kartoffel Orpheus DE (natural) · ~3.5 GB</option>
            <option value="kartoffel-orpheus-de-synthetic">Kartoffel Orpheus DE (synthetic) · ~3.5 GB</option>
            <option value="lex-au-orpheus-de">Lex.au Orpheus DE · ~3.5 GB</option>
          </optgroup>
          <optgroup label="Multilingual">
            <option value="cosyvoice3-tts">CosyVoice3 Q4 · ~384 MB</option>
            <option value="voxcpm2-tts">VoxCPM2 Q4 · ~1.6 GB</option>
            <option value="f5-tts">F5-TTS F16 · ~953 MB</option>
            <option value="speecht5">SpeechT5 F16 · ~300 MB</option>
            <option value="dia">Dia 1.6B F16 · ~3.0 GB</option>
            <option value="bark">Bark Q8 · ~500 MB</option>
          </optgroup>
        </select>
      </div>
      {/if}
    </div>
  </section>

  <!-- Speech-to-Text -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Speech-to-Text (Dictation)</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <div class="flex items-center justify-between">
        <label for="stt-engine" class="text-xs text-[var(--color-text-muted)]">{i18n.t.stt.engine}</label>
        <select id="stt-engine" bind:value={sttEngine} onchange={saveSttEngine} class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none">
          <option value="auto">{i18n.t.stt.engineAuto}</option>
          <option value="crispasr">{i18n.t.stt.engineCrispasr}</option>
          <option value="browser">{i18n.t.stt.engineBrowser}</option>
        </select>
      </div>
      {#if sttEngine !== 'browser'}
      <div>
        <label for="stt-model" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.stt.model}</label>
        <select id="stt-model" bind:value={sttModel} onchange={saveSttModel} class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none">
          <optgroup label="General (multilingual)">
            <option value="whisper">Whisper Base · ~147 MB · 99 languages</option>
            <option value="qwen3">Qwen3 ASR 0.6B Q4 · ~500 MB</option>
            <option value="qwen3-1.7b">Qwen3 ASR 1.7B Q4 · ~1.3 GB</option>
            <option value="canary">Canary 1B Q4 · ~600 MB · 4 languages</option>
            <option value="gemma4-e2b">Gemma4 E2B Q4 · ~2.5 GB · 140+ langs</option>
          </optgroup>
          <optgroup label="Fast (English)">
            <option value="moonshine">Moonshine Tiny Q4 · ~20 MB</option>
            <option value="moonshine-streaming">Moonshine Streaming Q4 · ~31 MB</option>
            <option value="fastconformer-ctc">FastConformer CTC Q4 · ~83 MB</option>
            <option value="parakeet">Parakeet TDT 0.6B Q4 · ~467 MB · 25 EU langs</option>
            <option value="parakeet-tdt-1.1b">Parakeet TDT 1.1B Q4 · ~808 MB</option>
          </optgroup>
          <optgroup label="German">
            <option value="moonshine-de">Moonshine Base DE Q4 · ~39 MB</option>
            <option value="moonshine-tiny-de">Moonshine Tiny DE Q4 · ~17 MB</option>
            <option value="wav2vec2-de">Wav2Vec2 DE Q4 · ~222 MB</option>
          </optgroup>
          <optgroup label="Specialized">
            <option value="sensevoice">SenseVoice Q4 · ~129 MB · Chinese/EN/JA/KO</option>
            <option value="omniasr">OmniASR CTC 1B Q4 · ~658 MB · 1600+ langs</option>
            <option value="firered-asr">FireRed ASR Q4 · ~918 MB</option>
            <option value="vibevoice">VibeVoice ASR Q4 · ~4.5 GB</option>
            <option value="mega-asr">Mega ASR 1.7B Q4 · ~1.3 GB</option>
          </optgroup>
        </select>
      </div>
      {/if}
    </div>
  </section>

  <!-- Model Manager (CrispASR desktop only) -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">Model Manager</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      {#if !isTauri}
        <p class="text-xs text-[var(--color-text-muted)]">
          Model management is available in the desktop app only. The web version uses BYOK OpenAI or MyMemory for translation, and browser APIs for TTS/STT.
        </p>
      {:else if !crispasrAvailable}
        <p class="text-xs text-[var(--color-text-muted)]">
          CrispASR not compiled in this build. Rebuild with <code class="bg-[var(--color-bg)] px-1 rounded text-[10px]">--features crispasr-metal</code> (macOS) or <code class="bg-[var(--color-bg)] px-1 rounded text-[10px]">crispasr-vulkan</code> (Linux/Windows).
        </p>
      {:else}
        <p class="text-xs text-[var(--color-text-muted)] mb-2">
          Models are downloaded on first use from HuggingFace and cached locally. Select a model above, then use it — it will auto-download.
        </p>
        {#if registryModels.length > 0}
          <div class="text-xs text-[var(--color-text-muted)] mb-1">{registryModels.length} models in registry</div>
          <div class="max-h-64 overflow-y-auto space-y-1 bg-[var(--color-bg)] rounded-md p-2 border border-[var(--color-border)]">
            {#each registryModels as model}
              <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-[var(--color-surface-hover)]">
                <div class="min-w-0">
                  <span class="text-xs font-medium truncate">{model.name}</span>
                  <span class="text-[10px] text-[var(--color-text-muted)] ml-1">{model.approx_size}</span>
                </div>
                <span class="text-[9px] text-[var(--color-text-muted)] truncate ml-2 max-w-32">{model.filename}</span>
              </div>
            {/each}
          </div>
        {:else}
          <button onclick={loadRegistry} class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md">
            Load Model Registry
          </button>
        {/if}
      {/if}
    </div>
  </section>
</div>
