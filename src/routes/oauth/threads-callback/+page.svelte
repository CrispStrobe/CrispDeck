<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { addAccount } from '$lib/db';
  import { getThreadsConfig, exchangeCodeForToken, exchangeForLongLivedToken, proxyExchangeToken, ThreadsClient } from '$lib/api/threads';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  onMount(async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const returnedState = params.get('state');
      const errorParam = params.get('error');

      if (errorParam) {
        throw new Error(`Threads authorization denied: ${errorParam}`);
      }

      if (!code) {
        throw new Error('No authorization code in callback URL');
      }

      // Verify state
      const savedState = localStorage.getItem('crispdeck-threads-oauth-state');
      if (savedState && returnedState !== savedState) {
        throw new Error('OAuth state mismatch. Please try again.');
      }

      const config = getThreadsConfig();
      if (!config) {
        throw new Error('No Threads OAuth config found. Please try connecting again.');
      }

      let accessToken: string;
      let userId: string;

      if (config.useProxy || !config.client_id || !config.client_secret) {
        // Use server proxy — client_secret stays server-side
        const result = await proxyExchangeToken(code, config.redirect_uri);
        accessToken = result.access_token;
        userId = result.user_id;
      } else {
        // Direct flow with custom credentials
        const shortLived = await exchangeCodeForToken(
          config.client_id,
          config.client_secret,
          config.redirect_uri,
          code,
        );

        const longLived = await exchangeForLongLivedToken(
          config.client_secret,
          shortLived.access_token,
        );

        accessToken = longLived.access_token;
        userId = shortLived.user_id ?? longLived.user_id ?? '';
      }

      // Fetch profile
      const client = new ThreadsClient(accessToken, userId);
      const profile = await client.getProfile();

      // Store the account
      const credentials = JSON.stringify({
        access_token: accessToken,
        user_id: userId,
        connected_at: new Date().toISOString(),
      });

      await addAccount({
        platform: 'threads',
        handle: `@${profile.username}`,
        display_name: profile.name || profile.username,
        avatar_url: profile.threads_profile_picture_url || undefined,
        credentials,
        is_primary: false,
      });

      // Clean up
      localStorage.removeItem('crispdeck-threads-oauth-state');

      status = 'success';
      setTimeout(() => goto('/settings'), 1500);
    } catch (e) {
      status = 'error';
      errorMsg = String(e);
      console.error('Threads OAuth callback failed:', e);
    }
  });
</script>

<div class="flex items-center justify-center min-h-screen bg-[var(--color-bg)]">
  <div class="max-w-md w-full mx-4 p-8 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] text-center">
    {#if status === 'loading'}
      <Loader2 size={48} class="text-[var(--color-primary)] animate-spin mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connecting Threads Account</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Completing authorization...</p>
    {:else if status === 'success'}
      <Check size={48} class="text-[var(--color-success)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Threads Account Connected!</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Redirecting to settings...</p>
    {:else}
      <AlertTriangle size={48} class="text-[var(--color-danger)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connection Failed</h2>
      <p class="text-sm text-red-400 mb-4">{errorMsg}</p>
      <a href="/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] text-white rounded-md text-sm">Back to Settings</a>
    {/if}
  </div>
</div>
