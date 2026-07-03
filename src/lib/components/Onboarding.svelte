<script lang="ts">
  import { ArrowLeft } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';

  interface Props {
    onconnectbluesky: () => void;
    onconnectblueskypassword: (handle: string, password: string) => void;
    onconnectmastodon: (instanceUrl: string) => void;
    onconnectthreads: () => void;
  }

  let { onconnectbluesky, onconnectblueskypassword, onconnectmastodon, onconnectthreads }: Props = $props();

  type Network = 'bluesky' | 'mastodon' | 'threads' | null;
  let selected: Network = $state(null);

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

        {#if selected === 'bluesky'}
          <div class="space-y-4">
            <button
              onclick={onconnectbluesky}
              class="w-full px-6 py-3 bg-[#0085FF] hover:bg-[#0070DD] text-white font-medium rounded-lg transition-colors"
            >
              {i18n.t.onboarding.blueskyOAuth}
            </button>

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
                onclick={() => onconnectblueskypassword(bskyHandle.trim(), bskyAppPassword)}
                disabled={!bskyHandle.trim() || !bskyAppPassword.trim()}
                class="w-full px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.bluesky)}
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
              onclick={() => onconnectmastodon(mastoInstance.trim())}
              disabled={!mastoInstance.trim()}
              class="w-full px-4 py-2 bg-[#6364FF] hover:bg-[#5254DD] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.mastodon)}
            </button>
          </div>

        {:else if selected === 'threads'}
          <div class="space-y-4">
            <p class="text-sm text-[var(--color-text-muted)]">{i18n.t.settings.threadsHint}</p>
            <button
              onclick={onconnectthreads}
              class="w-full px-6 py-3 bg-[var(--color-text)] text-[var(--color-bg)] font-medium rounded-lg transition-colors hover:opacity-90"
            >
              {i18n.t.onboarding.connectWith.replace('{network}', i18n.t.common.threads)}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
