<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { addAccount, listAccounts } from '$lib/db';
  import { initBlueskyOAuth } from '$lib/api/bluesky-oauth';
  import { invalidateClientCache } from '$lib/api/client-factory';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  onMount(async () => {
    try {
      // init() processes the OAuth callback params in the URL automatically
      const result = await initBlueskyOAuth();
      if (!result) throw new Error('OAuth callback did not return a session. Please try again.');

      const { did, agent } = result;
      const profile = await agent.getProfile({ actor: did });

      await addAccount({
        platform: 'bluesky',
        handle: profile.data.handle,
        display_name: profile.data.displayName,
        avatar_url: profile.data.avatar,
        did,
        credentials: JSON.stringify({ auth_method: 'oauth', did }),
        is_primary: false,
      });

      invalidateClientCache();
      status = 'success';
      const allAccounts = await listAccounts();
      const dest = allAccounts.length === 1 ? '/feed' : '/settings';
      setTimeout(() => goto(dest), 1500);
    } catch (e) {
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
