<script lang="ts">
  import { Shield } from '@lucide/svelte';
</script>

<svelte:head>
  <title>CrispDeck — Privacy Policy</title>
  <meta name="description" content="CrispDeck privacy policy — how your data is handled." />
</svelte:head>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center gap-2 mb-6">
    <Shield size={24} />
    <h1 class="text-2xl font-bold">Privacy Policy</h1>
  </div>

  <p class="text-xs text-[var(--color-text-muted)] mb-6">Last updated: July 2026</p>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">1. Data Controller</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      Christian Ströbele<br />
      Nikolausstr. 5, 70190 Stuttgart, Germany<br />
      Email: <a href="mailto:postmaster@crispstro.be" class="text-[var(--color-primary)] hover:underline">postmaster@crispstro.be</a>
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">2. What Data CrispDeck Stores</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">
      CrispDeck is designed to keep your data on your device. The following is stored <strong>locally</strong>:
    </p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li>Account credentials and OAuth tokens (encrypted with AES-256-GCM via Tauri's secure store)</li>
      <li>Timeline posts, drafts, and media cached for offline display (IndexedDB / SQLite)</li>
      <li>App settings, column layout, and preferences (localStorage / Tauri store)</li>
      <li>Scheduled posts pending upload (local SQLite database)</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">
      None of this data is transmitted to the developer or any third party by CrispDeck itself.
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">3. Push Notifications (Optional)</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      If you opt in to push notifications, your browser or device generates a <strong>push subscription</strong>
      (a VAPID endpoint URL and encryption keys) that is sent to the developer's notification relay hosted on Vercel.
      This subscription is used solely to deliver notifications from your connected social accounts. It is not
      linked to your identity, is not shared with third parties, and can be revoked at any time by disabling
      notifications in CrispDeck settings.
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">4. Third-Party API Connections</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">
      When you use CrispDeck, it connects directly to the APIs of the social networks you configure:
    </p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li><strong>Mastodon instances</strong> — your chosen instance's API server</li>
      <li><strong>Bluesky (ATProto)</strong> — bsky.social or your chosen PDS</li>
      <li><strong>Threads (Meta)</strong> — graph.threads.net</li>
      <li><strong>LibreTranslate</strong> — for optional post translation (public instance or self-hosted)</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">
      Each service's own privacy policy governs data processed by their servers. CrispDeck does not proxy,
      log, or inspect these API requests.
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">5. Analytics and Tracking</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      CrispDeck contains <strong>no analytics, crash reporting, or telemetry</strong>. No data is sent
      to the developer about how you use the app, which features you access, or any usage patterns.
      The app's "Analytics" feature calculates engagement statistics entirely locally from your own post history.
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">6. Camera, Microphone, and Photo Library</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      CrispDeck requests access to your camera, microphone, and photo library solely to let you attach
      media to posts. Photos and audio are uploaded directly to your social network's media endpoint;
      they are not stored or processed by the developer.
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">7. Your Rights (GDPR)</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mb-2">
      Under the GDPR you have the right to access, rectify, erase, and port your data, as well as the
      right to object to or restrict processing. Since CrispDeck stores all personal data locally on
      your device, you can exercise these rights at any time by:
    </p>
    <ul class="text-sm text-[var(--color-text-muted)] leading-relaxed list-disc list-inside space-y-1">
      <li>Deleting the app (removes all local data)</li>
      <li>Clearing app storage in your OS settings</li>
      <li>Revoking push notification subscriptions in app settings</li>
    </ul>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed mt-2">
      For questions, contact: <a href="mailto:postmaster@crispstro.be" class="text-[var(--color-primary)] hover:underline">postmaster@crispstro.be</a>
    </p>
  </section>

  <section class="mb-6 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
    <h2 class="text-sm font-semibold mb-2">8. Changes to This Policy</h2>
    <p class="text-sm text-[var(--color-text-muted)] leading-relaxed">
      If this privacy policy changes materially, the updated version will be published at this URL
      and the "Last updated" date above will be revised. Continued use of the app after changes
      constitutes acceptance.
    </p>
  </section>
</div>
