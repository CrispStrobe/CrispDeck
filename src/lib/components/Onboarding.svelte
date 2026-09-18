<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import { i18n } from '$lib/i18n.svelte';
  import { isTauri } from '$lib/platform';
  import { OAUTH_UNAVAILABLE_IN_APP } from '$lib/api/bluesky-oauth';

  // OAuth cannot complete inside the Tauri webview, so don't lead with it there.
  const oauthAvailable = !isTauri();

  interface Props {
    // Every one of these is slow and most end in a redirect, so they may
    // return a promise and this component waits on it — see `busy`.
    onconnectbluesky: () => void | Promise<void>;
    onconnectblueskypassword: (handle: string, password: string) => void | Promise<void>;
    onconnectmastodon: (instanceUrl: string) => void | Promise<void>;
    onconnectthreads: () => void | Promise<void>;
    /** Failure from the last connect attempt. Without somewhere to show this,
     *  a rejected sign-in is indistinguishable from a dead button. */
    error?: string;
  }

  let { onconnectbluesky, onconnectblueskypassword, onconnectmastodon, onconnectthreads, error = '' }: Props = $props();

  type Network = 'bluesky' | 'mastodon' | 'threads' | null;
  let selected: Network = $state(null);

  /**
   * Which connect button is mid-flight, if any.
   *
   * Signing in is not quick and cannot be made quick: before the browser
   * redirects anywhere, Bluesky OAuth resolves the authorization server's
   * metadata, generates a DPoP key, and makes a pushed authorization request
   * that is normally rejected once to hand out a DPoP nonce and repeated with
   * it. That is four sequential round trips to bsky.social, plus the
   * authorization server fetching our client metadata, before the page moves.
   * Mastodon has to register an app with the instance first, which is its own
   * round trip.
   *
   * None of that was visible, so the button looked dead for several seconds
   * and the natural response is to click it again. The wait stays; showing it
   * is the fix.
   */
  let busy: 'oauth' | 'password' | 'mastodon' | 'threads' | null = $state(null);

  async function run(which: NonNullable<typeof busy>, fn: () => void | Promise<void>) {
    if (busy) return;   // a second click would start a second sign-in
    busy = which;
    try {
      await fn();
    } finally {
      // On the OAuth paths we are usually gone before this runs. It matters on
      // the paths that fail: the button has to become clickable again.
      busy = null;
    }
  }

  // Form inputs
  let bskyHandle = $state('');
  let bskyAppPassword = $state('');
  let mastoInstance = $state('');

  function back() {
    selected = null;
    bskyHandle = '';
    bskyAppPassword = '';
    mastoInstance = '';
  }
</script>

<!-- Warm the connection to whichever network the user just picked. app.html
     preconnects at page load, but browsers drop idle sockets long before
     someone has read the welcome screen and chosen — so by the time they click
     Sign in, the handshake is being paid for again in front of them. -->
<svelte:head>
  {#if selected === 'bluesky'}
    <link rel="preconnect" href="https://bsky.social" crossorigin="anonymous" />
  {/if}
</svelte:head>

<div class="min-h-[70vh] flex flex-col items-center justify-center px-4">
  <div class="max-w-lg w-full text-center">
    <!-- App icon + title -->
    <div class="mb-8">
      <img src="/favicon.png" alt="CrispDeck" class="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg" />
      <h1 class="text-3xl font-bold mb-2">{i18n.t.onboarding.welcome}</h1>
      <p class="text-[var(--color-text-muted)]">{i18n.t.onboarding.subtitle}</p>
    </div>

    {#if selected === null}
      <!-- Stage 1: Network selector -->
      <div class="space-y-3">
        <button
          onclick={() => selected = 'bluesky'}
          class="w-full flex items-center gap-4 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-xl p-5 border border-[var(--color-border)] transition-colors text-left"
        >
          <div class="w-10 h-10 rounded-full bg-[#0085FF] flex-shrink-0"></div>
          <div>
            <div class="font-semibold">{i18n.t.common.bluesky}</div>
            <div class="text-sm text-[var(--color-text-muted)]">{i18n.t.onboarding.blueskyDesc}</div>
          </div>
        </button>

        <button
          onclick={() => selected = 'mastodon'}
          class="w-full flex items-center gap-4 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-xl p-5 border border-[var(--color-border)] transition-colors text-left"
        >
          <div class="w-10 h-10 rounded-full bg-[#6364FF] flex-shrink-0"></div>
          <div>
            <div class="font-semibold">{i18n.t.common.mastodon}</div>
            <div class="text-sm text-[var(--color-text-muted)]">{i18n.t.onboarding.mastodonDesc}</div>
          </div>
        </button>

        <button
          onclick={() => selected = 'threads'}
          class="w-full flex items-center gap-4 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-xl p-5 border border-[var(--color-border)] transition-colors text-left"
        >
          <div class="w-10 h-10 rounded-full bg-[var(--color-text)] flex-shrink-0"></div>
          <div>
            <div class="font-semibold">{i18n.t.common.threads}</div>
            <div class="text-sm text-[var(--color-text-muted)]">{i18n.t.onboarding.threadsDesc}</div>
          </div>
        </button>
      </div>

    {:else}
      <!-- Stage 2: Inline connect form -->
      <div class="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6">
        <button
          onclick={back}
          class="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-4 transition-colors"
        >
          <ArrowLeft size={16} />
          {i18n.t.onboarding.back}
        </button>

        {#if error}
          <div role="alert" class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm break-words">
            {error}
          </div>
        {/if}

        {#if selected === 'bluesky'}
          <div class="space-y-4">
            {#if oauthAvailable}
              <button
                onclick={() => run('oauth', onconnectbluesky)}
                disabled={busy !== null}
                aria-busy={busy === 'oauth'}
                class="w-full px-6 py-3 bg-[#0085FF] hover:bg-[#0070DD] text-white font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2"
              >
                {#if busy === 'oauth'}
                  <Loader2 size={16} class="animate-spin" />
                  {i18n.t.onboarding.contacting.replace('{network}', i18n.t.common.bluesky)}
                {:else}
                  {i18n.t.onboarding.blueskyOAuth}
                {/if}
              </button>
            {:else}
              <p class="text-xs text-[var(--color-text-muted)]">{OAUTH_UNAVAILABLE_IN_APP}</p>
            {/if}

            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-[var(--color-border)]"></div>
              </div>
              <div class="relative flex justify-center text-xs">
                <span class="px-2 bg-[var(--color-surface)] text-[var(--color-text-muted)]">{i18n.t.onboarding.blueskyAppPassword}</span>
              </div>
            </div>

            <div class="space-y-3 text-left">
              <div>
                <label for="bsky-handle" class="block text-sm font-medium mb-1">{i18n.t.onboarding.handle}</label>
                <input
                  id="bsky-handle"
                  type="text"
                  bind:value={bskyHandle}
                  placeholder={i18n.t.settings.handlePlaceholder}
                  class="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <div>
                <label for="bsky-password" class="block text-sm font-medium mb-1">{i18n.t.onboarding.appPassword}</label>
                <input
                  id="bsky-password"
                  type="password"
                  bind:value={bskyAppPassword}
                  placeholder={i18n.t.settings.appPasswordPlaceholder}
                  class="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
              <button
                onclick={() => run('password', () => onconnectblueskypassword(bskyHandle.trim(), bskyAppPassword))}
                disabled={busy !== null || !bskyHandle.trim() || !bskyAppPassword.trim()}
                aria-busy={busy === 'password'}
                class="w-full px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {#if busy === 'password'}
                  <Loader2 size={16} class="animate-spin" />
                  {i18n.t.onboarding.signingIn}
                {:else}
                  {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.bluesky)}
                {/if}
              </button>
            </div>
          </div>

        {:else if selected === 'mastodon'}
          <div class="space-y-4 text-left">
            <div>
              <label for="masto-instance" class="block text-sm font-medium mb-1">{i18n.t.onboarding.mastodonInstance}</label>
              <input
                id="masto-instance"
                type="text"
                bind:value={mastoInstance}
                placeholder={i18n.t.settings.instancePlaceholder}
                class="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
            </div>
            <button
              onclick={() => run('mastodon', () => onconnectmastodon(mastoInstance.trim()))}
              disabled={busy !== null || !mastoInstance.trim()}
              aria-busy={busy === 'mastodon'}
              class="w-full px-4 py-2 bg-[#6364FF] hover:bg-[#5254DD] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {#if busy === 'mastodon'}
                <Loader2 size={16} class="animate-spin" />
                {i18n.t.onboarding.contacting.replace('{network}', mastoInstance.trim() || i18n.t.common.mastodon)}
              {:else}
                {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.mastodon)}
              {/if}
            </button>
          </div>

        {:else if selected === 'threads'}
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.threadsHint}</p>
            <button
              onclick={() => run('threads', onconnectthreads)}
              disabled={busy !== null}
              class="w-full px-6 py-3 bg-[var(--color-text)] text-[var(--color-bg)] font-medium rounded-lg transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.threads)}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
