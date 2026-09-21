<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { readJson, removeKey } from '$lib/safe-storage';
  import { verifyCallback, OAuthCallbackError, type StoredOAuthState } from '$lib/oauth-callback';
  import { fetchJson } from '$lib/http';
  import { swallow } from '$lib/debug-log';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { completeMastodonOAuth, addAccount, listAccounts } from '$lib/db';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  onMount(async () => {
    try {
      const params = new URLSearchParams(window.location.search);

      // readJson rather than a bare parse: a truncated or cleared entry should
      // say so, not throw a SyntaxError from inside a callback nobody watches.
      const stored = readJson<StoredOAuthState | null>('crispdeck-oauth-state', null);

      let code: string;
      try {
        code = verifyCallback(params, stored);
      } catch (e) {
        if (e instanceof OAuthCallbackError && e.discardStored) {
          removeKey('crispdeck-oauth-state');
        }
        throw e;
      }

      const { instance_url, client_id, client_secret, redirect_uri } = stored!;

      // Exchange code for token
      const result = await completeMastodonOAuth({
        instance_url,
        code,
        client_id,
        client_secret,
        redirect_uri,
      });

      // Fetch the user's profile to get their handle
      // A failed verify_credentials used to yield {} here, and the account
      // was stored under the handle "@undefined@instance".
      const profile = await fetchJson<any>(`${instance_url}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${result.access_token}` },
      }, 'verify credentials');

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
      removeKey('crispdeck-oauth-state');

      status = 'success';

      // Redirect: first account → feed, otherwise → settings
      const allAccounts = await listAccounts();
      const dest = allAccounts.length === 1 ? `${base}/feed` : `${base}/settings`;
      setTimeout(() => goto(dest), 1500);
    } catch (e) {
      status = 'error';
      errorMsg = String(e);
      swallow('oauth.callback', e);
    }
  });
</script>

<div class="flex items-center justify-center min-h-screen bg-[var(--color-bg)]">
  <div class="max-w-md w-full mx-4 p-8 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] text-center">
    {#if status === 'loading'}
      <Loader2 size={48} class="text-[var(--color-mastodon)] animate-spin mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">{i18n.t.oauth.connectingMastodon}</h2>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.oauth.completingAuth}</p>
    {:else if status === 'success'}
      <Check size={48} class="text-[var(--color-success)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">{i18n.t.oauth.accountConnected}</h2>
      <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.oauth.redirectingToSettings}</p>
    {:else}
      <AlertTriangle size={48} class="text-[var(--color-danger)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">{i18n.t.oauth.connectionFailed}</h2>
      <p class="text-sm text-red-400 mb-4">{errorMsg}</p>
      <a href="{base}/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] text-white rounded-md text-sm">{i18n.t.oauth.backToSettings}</a>
    {/if}
  </div>
</div>
