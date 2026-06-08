<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listAccounts, addAccount as dbAddAccount, deleteAccount as dbDeleteAccount,
    updateAccount as dbUpdateAccount, startMastodonOAuth as dbStartOAuth,
    completeMastodonOAuth as dbCompleteOAuth
  } from '$lib/db';
  import { Settings, Plus, Trash2, Star, ExternalLink, Loader2, Shield, Download, Upload, EyeOff } from '@lucide/svelte';
  import { startBlueskyOAuth } from '$lib/api/bluesky-oauth';
  import { i18n, type Language } from '$lib/i18n.svelte';
  import { requestPermission, getPermission, isSupported as notifSupported } from '$lib/push-notifications';
  import { getTranslateConfig, setTranslateConfig, type TranslateProvider } from '$lib/translate';
  import { jetstream } from '$lib/jetstream';
  import { getAIComposeConfig, setAIComposeConfig, type AIProvider } from '$lib/compose/ai';
  import { PROVIDER_PRESETS, getPreset, fetchModelsWithCache, type DiscoveredModel } from '$lib/byok-providers';
  import { listHashtagSets, saveHashtagSet, deleteHashtagSet, type HashtagSet } from '$lib/hashtag-bank';
  import { listTagGroups, saveTagGroup, deleteTagGroup, type TagGroup } from '$lib/tag-groups';
  import { listFeeds, addFeed, removeFeed, importOPML, type RssFeed } from '$lib/rss';
  import { getThreadsConfig, setThreadsConfig, getThreadsAuthUrl, exchangeCodeForToken, exchangeForLongLivedToken, ThreadsClient, getProxyAuthUrl, isThreadsAvailable } from '$lib/api/threads';
  import { listMutedWords, addMutedWord, removeMutedWord, toggleMutedWord, type MutedWord } from '$lib/muted-words';
  import { getAlertSettings, setAlertSettings } from '$lib/notification-alerts';
  import { exportSettings, importSettings, type SettingsExport } from '$lib/settings-export';
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

  // AI compose config
  const aiConfig = getAIComposeConfig();
  let aiProvider = $state<AIProvider>(aiConfig.provider);
  let aiPresetId = $state(aiConfig.presetId ?? 'openai');
  let aiBaseUrl = $state(aiConfig.baseUrl);
  let aiApiKey = $state(aiConfig.apiKey);
  let aiModel = $state(aiConfig.model);
  let aiVisionModel = $state(aiConfig.visionModel ?? '');
  let aiModels: DiscoveredModel[] = $state([]);
  let aiModelsLoading = $state(false);
  let aiModelsError = $state('');

  function handlePresetChange() {
    const preset = getPreset(aiPresetId);
    if (preset && aiPresetId !== 'custom') {
      aiBaseUrl = preset.baseUrl;
      aiModel = preset.defaultModel;
      aiVisionModel = preset.defaultVisionModel;
      aiModels = [];
    }
    saveAIConfig();
  }

  async function fetchAIModels() {
    const preset = getPreset(aiPresetId);
    aiModelsLoading = true;
    aiModelsError = '';
    try {
      aiModels = await fetchModelsWithCache(aiBaseUrl, aiApiKey, preset);
    } catch (e) {
      aiModelsError = String(e);
    } finally {
      aiModelsLoading = false;
    }
  }

  function saveAIConfig() {
    setAIComposeConfig({
      provider: aiProvider,
      presetId: aiPresetId,
      baseUrl: aiBaseUrl || 'https://api.openai.com/v1',
      apiKey: aiApiKey,
      model: aiModel || 'gpt-4o-mini',
      visionModel: aiVisionModel || undefined,
    });
  }

  // Hashtag bank
  let hashtagSets: HashtagSet[] = $state(listHashtagSets());
  let newHashtagSetName = $state('');
  let newHashtagSetTags = $state('');

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

  // Notifications
  let notifPermission = $state<'granted' | 'denied' | 'default'>('default');
  let notifLoading = $state(false);

  // Model manager
  let isTauri = $state(false);
  let crispasrAvailable = $state(false);
  let registryModels: Array<{ name: string; filename: string; approx_size: string; url: string }> = $state([]);

  onMount(async () => {
    // ... existing onMount runs loadAccounts
    // Check notification permission
    if (notifSupported()) {
      notifPermission = await getPermission();
    }

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

  let hideEngagement = $state(localStorage.getItem('crispdeck-hide-engagement') === 'true');
  let liveCounters = $state(localStorage.getItem('crispdeck-live-counters') === 'true');
  function handleLiveCountersChange() {
    localStorage.setItem('crispdeck-live-counters', String(liveCounters));
    jetstream.setEnabled(liveCounters);
  }

  // Tag groups
  let tagGroups: TagGroup[] = $state(listTagGroups());
  let newGroupName = $state('');
  let newGroupTags = $state('');

  // RSS feeds
  let rssFeeds: RssFeed[] = $state(listFeeds());
  let newFeedUrl = $state('');

  // Notification alerts
  const alertConfig = getAlertSettings();
  let alertSound = $state(alertConfig.soundEnabled);
  let alertDesktop = $state(alertConfig.desktopEnabled);
  function saveAlerts() { setAlertSettings({ soundEnabled: alertSound, desktopEnabled: alertDesktop }); }

  // Muted words
  let mutedWords: MutedWord[] = $state(listMutedWords());
  let newMutedWord = $state('');
  let newMutedIsRegex = $state(false);
  function handleHideEngagementChange() {
    localStorage.setItem('crispdeck-hide-engagement', String(hideEngagement));
  }

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let error = $state('');

  // Add Bluesky form
  let showBskyForm = $state(false);
  let bskyAuthMode: 'app-password' | 'oauth' = $state('oauth');
  let bskyHandle = $state('');
  let bskyAppPassword = $state('');
  let bsky2faToken = $state('');
  let bskyNeeds2fa = $state(false);
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

      // Verify credentials + fetch profile (with optional 2FA)
      const { BlueskyClient } = await import('$lib/api/bluesky');
      const testClient = new BlueskyClient(handle, bskyAppPassword);
      try {
        await testClient.login(bsky2faToken || undefined);
      } catch (loginErr: any) {
        // Check if 2FA is required
        const msg = String(loginErr);
        if (msg.includes('AuthFactorTokenRequired') || msg.includes('auth_factor')) {
          bskyNeeds2fa = true;
          bskyLoading = false;
          error = 'Two-factor authentication required. Check your email for the code and enter it below.';
          return;
        }
        throw loginErr;
      }
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

  // Add Threads form
  let showThreadsForm = $state(false);
  let threadsAdvanced = $state(false);
  let threadsClientId = $state('');
  let threadsClientSecret = $state('');
  let threadsLoading = $state(false);
  let threadsProxyAvailable = $state(false);

  // Check if server proxy is available on mount
  onMount(async () => {
    threadsProxyAvailable = await isThreadsAvailable();
  });

  async function handleStartThreadsOAuth() {
    threadsLoading = true;
    error = '';

    const redirectUri = `${window.location.origin}/oauth/threads-callback`;
    const state = crypto.randomUUID();
    localStorage.setItem('crispdeck-threads-oauth-state', state);

    try {
      if (threadsAdvanced && threadsClientId.trim() && threadsClientSecret.trim()) {
        // Advanced: use custom app credentials (direct flow)
        setThreadsConfig({
          client_id: threadsClientId.trim(),
          client_secret: threadsClientSecret.trim(),
          redirect_uri: redirectUri,
          useProxy: false,
        });

        const authUrl = getThreadsAuthUrl(threadsClientId.trim(), redirectUri, state);
        window.location.href = authUrl;
        return;
      }

      // Default: use server proxy
      const authUrl = await getProxyAuthUrl(redirectUri, state);
      if (!authUrl) {
        error = 'Threads proxy not configured on server. Set THREADS_CLIENT_ID and THREADS_CLIENT_SECRET in Vercel env vars, or use Advanced mode with your own Meta App credentials.';
        threadsLoading = false;
        return;
      }

      setThreadsConfig({
        redirect_uri: redirectUri,
        useProxy: true,
      });

      window.location.href = authUrl;
    } catch (e) {
      error = String(e);
      threadsLoading = false;
    }
  }

  const bskyAccounts = $derived(accounts.filter(a => a.platform === 'bluesky'));
  const mastoAccounts = $derived(accounts.filter(a => a.platform === 'mastodon'));
  const threadsAccounts = $derived(accounts.filter(a => a.platform === 'threads'));
</script>

<svelte:head><title>CrispDeck — Settings</title><meta name="description" content="Account management and app preferences" /></svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Settings size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.settings.title}</h1>
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
              {i18n.t.settings.oauthRecommended}
            </button>
            <button
              onclick={() => bskyAuthMode = 'app-password'}
              class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {bskyAuthMode === 'app-password' ? 'bg-[var(--color-bluesky)] text-white' : 'text-[var(--color-text-muted)]'}"
            >
              App Password
            </button>
          </div>

          <div>
            <label for="bsky-handle" class="block text-sm text-[var(--color-text-muted)] mb-1">{i18n.t.settings.handle}</label>
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
                {i18n.t.settings.connectOAuth}
              </button>
              <button onclick={() => showBskyForm = false} class="px-4 py-2 text-sm text-[var(--color-text-muted)]">{i18n.t.settings.cancel}</button>
            </div>
          {:else}
            <div>
              <label for="bsky-password" class="block text-sm text-[var(--color-text-muted)] mb-1">{i18n.t.settings.appPassword}</label>
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
            {#if bskyNeeds2fa}
              <div>
                <label for="bsky-2fa" class="block text-sm text-[var(--color-text-muted)] mb-1">2FA Code (check your email)</label>
                <input
                  id="bsky-2fa"
                  type="text"
                  bind:value={bsky2faToken}
                  placeholder="XXXXX-XXXXX"
                  class="w-full px-3 py-2 bg-[var(--color-bg)] border border-yellow-600 rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-yellow-400"
                />
              </div>
            {/if}
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
        {i18n.t.settings.noBluesky}.
      </p>
    {:else}
      <div class="space-y-2">
        {#each bskyAccounts as account}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              {#if account.avatar_url}
                <img loading="lazy" src={account.avatar_url} alt="" class="w-8 h-8 rounded-full" />
              {:else}
                <div class="w-8 h-8 rounded-full bg-[var(--color-bluesky)]/20 flex items-center justify-center text-xs">BS</div>
              {/if}
              <div>
                <span class="text-sm font-medium">{account.handle}</span>
                {#if account.is_primary}
                  <span class="ml-2 text-xs text-yellow-400">★ {i18n.t.settings.primary}</span>
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
            <label for="masto-instance" class="block text-sm text-[var(--color-text-muted)] mb-1">{i18n.t.settings.instance}</label>
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
                {i18n.t.settings.waitingAuth}
              {:else}
                {i18n.t.settings.authorizeOAuth}
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
        {i18n.t.settings.noMastodon}.
      </p>
    {:else}
      <div class="space-y-2">
        {#each mastoAccounts as account}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              {#if account.avatar_url}
                <img loading="lazy" src={account.avatar_url} alt="" class="w-8 h-8 rounded-full" />
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
                  <span class="ml-2 text-xs text-yellow-400">★ {i18n.t.settings.primary}</span>
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

  <!-- Threads Accounts -->
  <section class="mb-8">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-[var(--color-threads,#000)]"></div>
        Threads Accounts
      </h2>
      <button
        onclick={() => showThreadsForm = !showThreadsForm}
        class="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--color-threads,#000)] hover:opacity-90 rounded-md transition-opacity"
      >
        <Plus size={14} />
        Add
      </button>
    </div>

    {#if showThreadsForm}
      <div class="mb-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <div class="space-y-3">
          {#if !threadsAdvanced}
            <p class="text-xs text-[var(--color-text-muted)]">
              Connect your Threads account via OAuth. You'll be redirected to Threads to authorize.
            </p>
            <div class="flex gap-2">
              <button
                onclick={handleStartThreadsOAuth}
                disabled={threadsLoading}
                class="flex items-center gap-1 px-4 py-2 bg-[var(--color-primary)] hover:opacity-90 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {#if threadsLoading}<Loader2 size={14} class="animate-spin" />{/if}
                <Shield size={14} />
                Connect with Threads
              </button>
              <button
                onclick={() => showThreadsForm = false}
                class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
            </div>
            <button
              onclick={() => threadsAdvanced = true}
              class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              Advanced: use your own Meta App credentials
            </button>
          {:else}
            <p class="text-xs text-[var(--color-text-muted)]">
              Use your own Meta Developer App. Create one at
              <a href="https://developers.facebook.com" target="_blank" rel="noopener" class="underline">developers.facebook.com</a>
              with the Threads API product enabled.
            </p>
            <div>
              <label for="threads-client-id" class="block text-sm text-[var(--color-text-muted)] mb-1">App ID (Client ID)</label>
              <input
                id="threads-client-id"
                type="text"
                bind:value={threadsClientId}
                placeholder="123456789..."
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
            <div>
              <label for="threads-client-secret" class="block text-sm text-[var(--color-text-muted)] mb-1">App Secret</label>
              <input
                id="threads-client-secret"
                type="password"
                bind:value={threadsClientSecret}
                placeholder="abc123..."
                class="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
            <div class="flex gap-2">
              <button
                onclick={handleStartThreadsOAuth}
                disabled={threadsLoading || !threadsClientId.trim() || !threadsClientSecret.trim()}
                class="flex items-center gap-1 px-4 py-2 bg-[var(--color-primary)] hover:opacity-90 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {#if threadsLoading}<Loader2 size={14} class="animate-spin" />{/if}
                <Shield size={14} />
                Connect with Threads
              </button>
              <button
                onclick={() => showThreadsForm = false}
                class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Cancel
              </button>
            </div>
            <button
              onclick={() => threadsAdvanced = false}
              class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              Back to simple mode
            </button>
          {/if}
        </div>
      </div>
    {/if}

    {#if threadsAccounts.length === 0}
      <p class="text-sm text-[var(--color-text-muted)] p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        No Threads accounts connected.
      </p>
    {:else}
      <div class="space-y-2">
        {#each threadsAccounts as account}
          <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center gap-3">
              {#if account.avatar_url}
                <img loading="lazy" src={account.avatar_url} alt="" class="w-8 h-8 rounded-full" />
              {:else}
                <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs">T</div>
              {/if}
              <div>
                <span class="text-sm font-medium">{account.display_name || account.handle}</span>
                <span class="text-xs text-[var(--color-text-muted)] ml-1">{account.handle}</span>
                {#if account.is_primary}
                  <span class="ml-2 text-xs text-yellow-400">★ {i18n.t.settings.primary}</span>
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
          <option value="pt">Português</option>
          <option value="zh">中文</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <!-- Homepage mode -->
      <div class="flex items-center justify-between">
        <label for="home-mode" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.homepage}</label>
        <select
          id="home-mode"
          value={localStorage.getItem('crispdeck-home-mode') ?? 'dashboard'}
          onchange={(e) => localStorage.setItem('crispdeck-home-mode', (e.target as HTMLSelectElement).value)}
          class="px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text)] focus:outline-none"
        >
          <option value="dashboard">{i18n.t.settings.homeDashboard}</option>
          <option value="feed">{i18n.t.settings.homeFeed}</option>
          <option value="deck">{i18n.t.settings.homeDeck}</option>
        </select>
      </div>

      <!-- Push notifications -->
      <div class="flex items-center justify-between">
        <div>
          <span class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.pushNotifications}</span>
          <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.settings.pushHint}</p>
        </div>
        {#if notifPermission === 'granted'}
          <span class="text-xs text-green-400 px-2 py-1 bg-green-900/20 rounded">{i18n.t.settings.pushEnabled}</span>
        {:else if notifPermission === 'denied'}
          <span class="text-xs text-red-400 px-2 py-1 bg-red-900/20 rounded">{i18n.t.settings.pushBlocked}</span>
        {:else}
          <button
            onclick={async () => { notifLoading = true; notifPermission = await requestPermission(); notifLoading = false; }}
            disabled={notifLoading}
            class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-50"
          >
            {notifLoading ? '...' : i18n.t.settings.pushEnable}
          </button>
        {/if}
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

      <!-- Hide engagement counts -->
      <div class="flex items-center justify-between">
        <label for="hide-engagement" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.hideEngagement}</label>
        <input
          id="hide-engagement"
          type="checkbox"
          bind:checked={hideEngagement}
          onchange={handleHideEngagementChange}
          class="w-4 h-4 accent-[var(--color-primary)]"
        />
      </div>

      <!-- Live counters -->
      <div class="flex items-center justify-between">
        <div>
          <label for="live-counters" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.liveCounters}</label>
          <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.settings.liveCountersHint}</p>
        </div>
        <input
          id="live-counters"
          type="checkbox"
          bind:checked={liveCounters}
          onchange={handleLiveCountersChange}
          class="w-4 h-4 accent-[var(--color-primary)]"
        />
      </div>

      <!-- Notification sound -->
      <div class="flex items-center justify-between">
        <div>
          <label for="alert-sound" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.alertSound}</label>
          <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.settings.alertSoundHint}</p>
        </div>
        <input id="alert-sound" type="checkbox" bind:checked={alertSound} onchange={saveAlerts} class="w-4 h-4 accent-[var(--color-primary)]" />
      </div>

      <!-- Desktop notifications -->
      <div class="flex items-center justify-between">
        <div>
          <label for="alert-desktop" class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.alertDesktop}</label>
          <p class="text-[10px] text-[var(--color-text-muted)]">{i18n.t.settings.alertDesktopHint}</p>
        </div>
        <input id="alert-desktop" type="checkbox" bind:checked={alertDesktop} onchange={saveAlerts} class="w-4 h-4 accent-[var(--color-primary)]" />
      </div>
    </div>
  </section>

  <!-- Muted Words -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
      <EyeOff size={18} />
      {i18n.t.settings.mutedWordsTitle}
    </h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.mutedWordsHint}</p>

      {#if mutedWords.length > 0}
        <div class="space-y-1">
          {#each mutedWords as word}
            <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md {!word.enabled ? 'opacity-50' : ''}">
              <div class="flex items-center gap-2 min-w-0">
                <button onclick={() => { mutedWords = toggleMutedWord(word.id); }} class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                  <EyeOff size={12} />
                </button>
                <span class="text-sm truncate">{word.value}</span>
                {#if word.isRegex}
                  <span class="text-[9px] px-1 py-0.5 bg-yellow-900/30 text-yellow-400 rounded">regex</span>
                {/if}
              </div>
              <button
                onclick={() => { mutedWords = removeMutedWord(word.id); }}
                class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1 flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex gap-2">
        <input
          type="text"
          bind:value={newMutedWord}
          placeholder={i18n.t.settings.mutedWordPlaceholder}
          class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
          onkeydown={(e) => { if (e.key === 'Enter' && newMutedWord.trim()) { mutedWords = addMutedWord(newMutedWord.trim(), newMutedIsRegex); newMutedWord = ''; } }}
        />
        <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] cursor-pointer whitespace-nowrap">
          <input type="checkbox" bind:checked={newMutedIsRegex} class="w-3 h-3 accent-[var(--color-primary)]" />
          regex
        </label>
        <button
          onclick={() => {
            if (newMutedWord.trim()) {
              mutedWords = addMutedWord(newMutedWord.trim(), newMutedIsRegex);
              newMutedWord = '';
            }
          }}
          disabled={!newMutedWord.trim()}
          class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  </section>

  <!-- Export / Import Settings -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
      <Download size={18} />
      {i18n.t.settings.exportImportTitle}
    </h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.exportImportHint}</p>
      <div class="flex gap-2">
        <button
          onclick={() => {
            const data = exportSettings();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `crispdeck-settings-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-primary)] rounded-md hover:opacity-90"
        >
          <Download size={14} />
          {i18n.t.settings.exportBtn}
        </button>
        <label class="flex items-center gap-1.5 px-4 py-2 text-sm bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md cursor-pointer hover:bg-[var(--color-bg)]">
          <Upload size={14} />
          {i18n.t.settings.importBtn}
          <input
            type="file"
            accept=".json"
            class="hidden"
            onchange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string);
                    const count = importSettings(data);
                    alert(`Imported ${count} settings. Reload to apply all changes.`);
                  } catch (err) {
                    alert(`Import failed: ${err}`);
                  }
                };
                reader.readAsText(file);
              }
            }}
          />
        </label>
      </div>
    </div>
  </section>

  <!-- Tag Groups -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.tagGroupsTitle}</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.tagGroupsHint}</p>

      {#if tagGroups.length > 0}
        <div class="space-y-2">
          {#each tagGroups as group}
            <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md">
              <div>
                <span class="text-sm font-medium">{group.name}</span>
                <span class="text-[10px] text-[var(--color-text-muted)] ml-2">{group.tags.map(t => `#${t}`).join(' ')}</span>
              </div>
              <button
                onclick={() => { deleteTagGroup(group.id); tagGroups = listTagGroups(); }}
                class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex gap-2">
        <input
          type="text"
          bind:value={newGroupName}
          placeholder="Group name"
          class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        />
        <input
          type="text"
          bind:value={newGroupTags}
          placeholder="tag1, tag2, tag3"
          class="flex-2 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        />
        <button
          onclick={() => {
            if (newGroupName.trim() && newGroupTags.trim()) {
              saveTagGroup({ name: newGroupName.trim(), tags: newGroupTags.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean) });
              tagGroups = listTagGroups();
              newGroupName = '';
              newGroupTags = '';
            }
          }}
          disabled={!newGroupName.trim() || !newGroupTags.trim()}
          class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  </section>

  <!-- RSS Feeds -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.rssFeedsTitle}</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.rssFeedsHint}</p>

      {#if rssFeeds.length > 0}
        <div class="space-y-2">
          {#each rssFeeds as feed}
            <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md">
              <div class="min-w-0">
                <span class="text-sm font-medium">{feed.title}</span>
                <span class="text-[10px] text-[var(--color-text-muted)] block truncate">{feed.url}</span>
              </div>
              <button
                onclick={() => { removeFeed(feed.id); rssFeeds = listFeeds(); }}
                class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1 flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flex gap-2">
        <input
          type="url"
          bind:value={newFeedUrl}
          placeholder="https://example.com/feed.xml"
          class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        />
        <button
          onclick={() => {
            if (newFeedUrl.trim()) {
              try { addFeed(newFeedUrl.trim()); rssFeeds = listFeeds(); newFeedUrl = ''; } catch {}
            }
          }}
          disabled={!newFeedUrl.trim()}
          class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
        >
          <Plus size={12} />
        </button>
      </div>

      <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
        <input
          type="file"
          accept=".opml,.xml"
          class="hidden"
          onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
              const reader = new FileReader();
              reader.onload = () => {
                const imported = importOPML(reader.result as string);
                rssFeeds = listFeeds();
                alert(`Imported ${imported.length} feeds.`);
              };
              reader.readAsText(file);
            }
          }}
        />
        {i18n.t.settings.importOPML}
      </label>
    </div>
  </section>

  <!-- Translation -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.translateTarget}</h2>
    <div class="space-y-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <!-- Provider -->
      <div>
        <label class="block text-sm text-[var(--color-text-muted)] mb-2">{i18n.t.settings.translationProvider}</label>
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
            M2M-100 is recommended for most use cases. WMT21 is higher quality for EN↔zh,de,fr,ja,ru,is,ha. MADLAD covers 419 languages. All models are commercially licensed (MIT / Apache-2.0).
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

  <!-- AI Compose -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.aiComposeTitle}</h2>
    <div class="space-y-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">{i18n.t.settings.aiComposeHint}</p>

      <!-- Provider type -->
      <div>
        <label class="block text-xs text-[var(--color-text-muted)] mb-2">{i18n.t.compose.aiProvider}</label>
        <div class="flex items-center bg-[var(--color-bg)] rounded-lg border border-[var(--color-border)] p-0.5">
          <button
            onclick={() => { aiProvider = 'openai'; saveAIConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {aiProvider === 'openai' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            {i18n.t.compose.aiProviderByok}
          </button>
          <button
            onclick={() => { aiProvider = 'crispasr'; saveAIConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {aiProvider === 'crispasr' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            {i18n.t.compose.aiProviderCrispasr}
          </button>
          <button
            onclick={() => { aiProvider = 'mistral-rs'; saveAIConfig(); }}
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors {aiProvider === 'mistral-rs' ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'}"
          >
            {i18n.t.compose.aiProviderMistralrs}
          </button>
        </div>
      </div>

      {#if aiProvider === 'openai'}
        <!-- Provider preset -->
        <div>
          <label for="ai-preset" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.compose.aiPreset}</label>
          <select
            id="ai-preset"
            bind:value={aiPresetId}
            onchange={handlePresetChange}
            class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
          >
            {#each PROVIDER_PRESETS as preset}
              <option value={preset.id}>{preset.name}</option>
            {/each}
          </select>
        </div>

        <!-- Base URL (editable for custom, shown read-only for presets) -->
        <div>
          <label for="ai-base-url" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.translation.apiBaseUrl}</label>
          <input id="ai-base-url" type="text" bind:value={aiBaseUrl} onchange={saveAIConfig}
            placeholder="https://api.openai.com/v1"
            readonly={aiPresetId !== 'custom'}
            class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] {aiPresetId !== 'custom' ? 'opacity-60' : ''}" />
        </div>

        <!-- API Key -->
        {#if getPreset(aiPresetId)?.requiresApiKey !== false}
          <div>
            <div class="flex items-center justify-between mb-1">
              <label for="ai-api-key" class="text-xs text-[var(--color-text-muted)]">{i18n.t.translation.apiKey}</label>
              {#if getPreset(aiPresetId)?.docsUrl}
                <a href={getPreset(aiPresetId)?.docsUrl} target="_blank" rel="noopener" class="text-[10px] text-[var(--color-primary)] hover:underline flex items-center gap-0.5">
                  {i18n.t.compose.aiGetApiKey}
                  <ExternalLink size={10} />
                </a>
              {/if}
            </div>
            <input id="ai-api-key" type="password" bind:value={aiApiKey} onchange={saveAIConfig}
              placeholder="sk-..."
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]" />
          </div>
        {/if}

        <!-- Model selection with fetch -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label for="ai-model" class="text-xs text-[var(--color-text-muted)]">{i18n.t.translation.modelName}</label>
            <button
              onclick={fetchAIModels}
              disabled={aiModelsLoading || (!aiApiKey && getPreset(aiPresetId)?.requiresApiKey !== false)}
              class="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
            >
              {#if aiModelsLoading}
                <Loader2 size={10} class="animate-spin" />
                {i18n.t.compose.aiFetchingModels}
              {:else}
                {i18n.t.compose.aiFetchModels}
              {/if}
            </button>
          </div>
          {#if aiModels.length > 0}
            <select
              id="ai-model"
              bind:value={aiModel}
              onchange={saveAIConfig}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            >
              {#each aiModels as model}
                <option value={model.id}>{model.id}</option>
              {/each}
            </select>
          {:else}
            <input id="ai-model" type="text" bind:value={aiModel} onchange={saveAIConfig}
              placeholder={getPreset(aiPresetId)?.defaultModel ?? 'gpt-4o-mini'}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]" />
          {/if}
          {#if aiModelsError}
            <p class="text-[10px] text-red-400 mt-1">{aiModelsError}</p>
          {/if}
        </div>

        <!-- Vision model for alt-text -->
        <div>
          <label for="ai-vision-model" class="block text-xs text-[var(--color-text-muted)] mb-1">{i18n.t.compose.aiVisionModel}</label>
          {#if aiModels.length > 0}
            <select
              id="ai-vision-model"
              bind:value={aiVisionModel}
              onchange={saveAIConfig}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
            >
              <option value="">Same as text model</option>
              {#each aiModels as model}
                <option value={model.id}>{model.id}</option>
              {/each}
            </select>
          {:else}
            <input id="ai-vision-model" type="text" bind:value={aiVisionModel} onchange={saveAIConfig}
              placeholder={getPreset(aiPresetId)?.defaultVisionModel ?? 'gpt-4o'}
              class="w-full px-3 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]" />
          {/if}
          <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
            Used for image alt-text generation. Leave empty to use the text model.
          </p>
        </div>
      {:else}
        <p class="text-xs text-[var(--color-text-muted)]">
          {aiProvider === 'crispasr' ? 'CrispASR uses bundled llama.cpp for local inference. No API key needed. Requires desktop app.' : 'mistral.rs uses Rust-native inference. No API key needed. Requires desktop app.'}
        </p>
      {/if}
    </div>
  </section>

  <!-- Hashtag Bank -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.compose.hashtagBank}</h2>
    <div class="space-y-3 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
      <p class="text-[11px] text-[var(--color-text-muted)]">Save sets of hashtags for quick insertion into compose.</p>

      {#if hashtagSets.length > 0}
        <div class="space-y-2">
          {#each hashtagSets as set}
            <div class="flex items-center justify-between p-2 bg-[var(--color-bg)] rounded-md">
              <div>
                <span class="text-sm font-medium">{set.name}</span>
                <span class="text-[10px] text-[var(--color-text-muted)] ml-2">{set.hashtags.join(' ')}</span>
              </div>
              <button
                onclick={() => { deleteHashtagSet(set.id); hashtagSets = listHashtagSets(); }}
                class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.compose.noHashtagSets}</p>
      {/if}

      <div class="flex gap-2">
        <input
          type="text"
          bind:value={newHashtagSetName}
          placeholder={i18n.t.compose.hashtagSetName}
          class="flex-1 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        />
        <input
          type="text"
          bind:value={newHashtagSetTags}
          placeholder={i18n.t.compose.hashtagSetTags}
          class="flex-2 px-2 py-1.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-xs text-[var(--color-text)] focus:outline-none"
        />
        <button
          onclick={() => {
            if (newHashtagSetName.trim() && newHashtagSetTags.trim()) {
              saveHashtagSet({
                name: newHashtagSetName.trim(),
                hashtags: newHashtagSetTags.split(/[\s,]+/).map(t => t.trim()).filter(Boolean),
              });
              hashtagSets = listHashtagSets();
              newHashtagSetName = '';
              newHashtagSetTags = '';
            }
          }}
          disabled={!newHashtagSetName.trim() || !newHashtagSetTags.trim()}
          class="px-3 py-1.5 text-xs bg-[var(--color-primary)] text-white rounded-md disabled:opacity-30"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  </section>

  <!-- Text-to-Speech -->
  <section class="mb-8">
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.ttsTitle}</h2>
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
    <h2 class="text-lg font-semibold mb-3">{i18n.t.settings.sttTitle}</h2>
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
