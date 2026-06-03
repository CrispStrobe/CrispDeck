<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { addAccount } from '$lib/db';
  import { handleBlueskyOAuthCallback } from '$lib/api/bluesky-oauth';
  import { Loader2, Check, AlertTriangle } from '@lucide/svelte';

  let status: 'loading' | 'success' | 'error' = $state('loading');
  let errorMsg = $state('');

  onMount(async () => {
    try {
      const { did, handle, agent } = await handleBlueskyOAuthCallback();

      // Fetch profile for avatar/display name
      const profile = await agent.getProfile({ actor: did });

      // Store the account — mark as OAuth (credentials store the auth method)
      await addAccount({
        platform: 'bluesky',
        handle: profile.data.handle ?? handle,
        display_name: profile.data.displayName,
        avatar_url: profile.data.avatar,
        did,
        credentials: JSON.stringify({ auth_method: 'oauth', did }),
        is_primary: false,
      });

      status = 'success';
      setTimeout(() => goto('/settings'), 1500);
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
