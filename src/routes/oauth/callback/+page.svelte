<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { completeMastodonOAuth, addAccount, listAccounts } from '$lib/db';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  onMount(async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');

      if (!code) {
        throw new Error('No authorization code in callback URL');
      }

      // Retrieve the OAuth state we stored before redirecting
      const oauthState = localStorage.getItem('crispdeck-oauth-state');
      if (!oauthState) {
        throw new Error('No OAuth state found. Please try connecting your account again.');
      }

      const { instance_url, client_id, client_secret, redirect_uri } = JSON.parse(oauthState);

      // Exchange code for token
      const result = await completeMastodonOAuth({
        instance_url,
        code,
        client_id,
        client_secret,
        redirect_uri,
      });

      // Fetch the user's profile to get their handle
      const profileResp = await fetch(`${instance_url}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${result.access_token}` },
      });
      const profile = await profileResp.json();

      const handle = `@${profile.acct ?? profile.username}@${new URL(instance_url).hostname}`;

      // Store the account
      const credentials = JSON.stringify({
        access_token: result.access_token,
        client_id,
        client_secret,
      });

      await addAccount({
        platform: 'mastodon',
        handle,
        display_name: profile.display_name || profile.username,
        avatar_url: profile.avatar,
        instance_url,
        mastodon_id: profile.id,
        credentials,
        is_primary: false,
      });

      // Clean up OAuth state
      localStorage.removeItem('crispdeck-oauth-state');

      status = 'success';

      // Redirect: first account → feed, otherwise → settings
      const allAccounts = await listAccounts();
      const dest = allAccounts.length === 1 ? '/feed' : '/settings';
      setTimeout(() => goto(dest), 1500);
    } catch (e) {
      status = 'error';
      errorMsg = String(e);
      console.error('OAuth callback failed:', e);
    }
  });
</script>

<div class="flex items-center justify-center min-h-screen bg-[var(--color-bg)]">
  <div class="max-w-md w-full mx-4 p-8 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] text-center">
    {#if status === 'loading'}
      <Loader2 size={48} class="text-[var(--color-mastodon)] animate-spin mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connecting Mastodon Account</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Completing authorization...</p>
    {:else if status === 'success'}
      <Check size={48} class="text-[var(--color-success)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Account Connected!</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Redirecting to settings...</p>
    {:else}
      <AlertTriangle size={48} class="text-[var(--color-danger)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connection Failed</h2>
      <p class="text-sm text-red-400 mb-4">{errorMsg}</p>
      <a href="/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] text-white rounded-md text-sm">Back to Settings</a>
    {/if}
  </div>
</div>
