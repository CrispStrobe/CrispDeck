<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { addAccount, updateAccount, listAccounts } from '$lib/db';
  import { initBlueskyOAuth, wasSilentReauthAttempt, clearSilentReauthFlag, OAUTH_RETURN_TO_KEY } from '$lib/api/bluesky-oauth';
  import { invalidateClientCache } from '$lib/api/client-factory';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  function takeReturnTo(): string | null {
    try {
      const path = sessionStorage.getItem(OAUTH_RETURN_TO_KEY);
      sessionStorage.removeItem(OAUTH_RETURN_TO_KEY);
      return path && path.startsWith('/') ? path : null;
    } catch {
      return null;
    }
  }

  onMount(async () => {
    const silent = wasSilentReauthAttempt();
    try {
      // init() processes the OAuth callback params in the URL automatically
      const result = await initBlueskyOAuth();
      if (!result) throw new Error('OAuth callback did not return a session. Please try again.');

      const { did, agent } = result;
      const profile = await agent.getProfile({ actor: did });

      // Re-auth of an already-connected account must update it, not duplicate it
      const allAccounts = await listAccounts();
      const existing = allAccounts.find((a) => a.platform === 'bluesky' && a.did === did);
      if (existing) {
        await updateAccount({
          id: existing.id,
          display_name: profile.data.displayName,
          avatar_url: profile.data.avatar,
        });
      } else {
        await addAccount({
          platform: 'bluesky',
          handle: profile.data.handle,
          display_name: profile.data.displayName,
          avatar_url: profile.data.avatar,
          did,
          credentials: JSON.stringify({ auth_method: 'oauth', did }),
          is_primary: false,
        });
      }

      invalidateClientCache();
      clearSilentReauthFlag();
      status = 'success';
      const returnTo = takeReturnTo();
      if (silent && returnTo) {
        // Silent re-auth round-trip: go straight back, no success screen needed
        goto(returnTo);
        return;
      }
      const dest = returnTo ?? ((await listAccounts()).length === 1 ? '/feed' : '/settings');
      setTimeout(() => goto(dest), 1500);
    } catch (e) {
      clearSilentReauthFlag();
      if (silent) {
        // Silent re-auth failed (e.g. login_required: no live bsky.social
        // cookie). Return the user where they were — pages already show a
        // reconnect hint; never strand them on an error screen they
        // didn't ask for.
        console.warn('Silent Bluesky re-auth failed:', e);
        goto(takeReturnTo() ?? '/feed');
        return;
      }
      status = 'error';
      errorMsg = String(e);
      console.error('Bluesky OAuth callback failed:', e);
    }
  });
</script>

<div class="flex items-center justify-center min-h-screen bg-[var(--color-bg)]">
  <div class="max-w-md w-full mx-4 p-8 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] text-center">
    {#if status === 'loading'}
      <Loader2 size={48} class="text-[var(--color-bluesky)] animate-spin mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connecting Bluesky</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Completing OAuth authorization...</p>
    {:else if status === 'success'}
      <Check size={48} class="text-[var(--color-success)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Bluesky Connected via OAuth!</h2>
      <p class="text-sm text-[var(--color-text-muted)]">Full access enabled including DMs. Redirecting...</p>
    {:else}
      <AlertTriangle size={48} class="text-[var(--color-danger)] mx-auto mb-4" />
      <h2 class="text-lg font-bold mb-2">Connection Failed</h2>
      <p class="text-sm text-red-400 mb-4">{errorMsg}</p>
      <a href="/settings" class="inline-block px-4 py-2 bg-[var(--color-primary)] text-white rounded-md text-sm">Back to Settings</a>
    {/if}
  </div>
</div>
