<script lang="ts">
  import { i18n } from '$lib/i18n.svelte';
  import { Shield } from '@lucide/svelte';

  const p = $derived(i18n.t.privacy);
  // Shown only in a translation. The English text is the one that was drafted
  // and reviewed; a translated legal document that does not say which version
  // governs invites exactly the dispute it is meant to prevent.
  const isTranslation = $derived(i18n.lang !== 'en');
</script>

<svelte:head>
  <title>{p.pageTitle}</title>
  <meta name="description" content={p.metaDescription} />
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Shield size={24} />
    <h1 class="text-2xl font-bold">{i18n.t.about.privacyPolicy}</h1>
  </div>

  <p class="text-xs text-[var(--color-text-muted)] mb-2">{p.lastUpdated}</p>
  {#if isTranslation}
    <p class="text-xs text-[var(--color-text-muted)] italic mb-6">{p.translationNote}</p>
  {:else}
    <div class="mb-6"></div>
  {/if}

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s1Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      Christian Ströbele<br />
      Nikolausstr. 5, 70190 Stuttgart, Germany<br />
      Email: <a href="mailto:postmaster@crispstro.be" class="text-[var(--color-primary)] hover:underline">postmaster@crispstro.be</a>
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s2Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">{p.s2Intro} <strong>{p.s2Locally}</strong>:</p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li>{p.s2Credentials}</li>
      <li>{p.s2Cache}</li>
      <li>{p.s2Settings}</li>
      <li>{p.s2Scheduled}</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">{p.s2Outro}</p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s3Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">{p.s3Body1} <strong>{p.s3Subscription}</strong> {p.s3Body2}</p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s4Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">{p.s4Intro}</p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li><strong>{p.s4Mastodon}</strong> {p.s4MastodonDesc}</li>
      <li><strong>Bluesky (ATProto)</strong> {p.s4BlueskyDesc}</li>
      <li><strong>Threads (Meta)</strong> — graph.threads.net</li>
      <li><strong>LibreTranslate</strong> {p.s4LibreDesc}</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">{p.s4Outro}</p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s5Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">{p.s5Body1} <strong>{p.s5NoAnalytics}</strong>{p.s5Body2}</p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s6Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">{p.s6Body}</p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s7Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">{p.s7Intro}</p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li>{p.s7Delete}</li>
      <li>{p.s7Clear}</li>
      <li>{p.s7Revoke}</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">{p.s7Contact} <a href="mailto:postmaster@crispstro.be" class="text-[var(--color-primary)] hover:underline">postmaster@crispstro.be</a></p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">{p.s8Title}</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">{p.s8Body}</p>
  </section>
</div>
