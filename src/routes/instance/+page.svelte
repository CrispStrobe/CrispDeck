<script lang="ts">
  import { onMount } from 'svelte';
  import { initAllClients, type ClientEntry } from '$lib/api/client-factory';
  import { Server, Loader2, Users, MessageCircle, Shield, Mail, ExternalLink, Globe } from '@lucide/svelte';
  import { MastodonClient } from '$lib/api/mastodon';
  import type { Account } from '$lib/types';

  interface InstanceInfo {
    uri: string;
    title: string;
    shortDescription: string;
    description: string;
    email: string;
    version: string;
    stats: { userCount: number; statusCount: number; domainCount: number };
    thumbnail?: string;
    languages: string[];
    registrations: boolean;
    rules: Array<{ id: string; text: string }>;
    contact?: { email: string; account?: { acct: string; displayName: string; avatar: string } };
  }

  let accounts: Account[] = $state([]);
  let clientEntries: Map<number, ClientEntry> = new Map();
  let loading = $state(true);
  let error = $state('');
  let instance: InstanceInfo | null = $state(null);
  let instanceUrl = $state('');

  onMount(async () => {
    try {
      const result = await initAllClients();
      accounts = result.accounts;
      clientEntries = result.clients;

      // Find the first Mastodon account's instance
      const mastoAcct = accounts.find(a => a.platform === 'mastodon');
      if (mastoAcct?.instance_url) {
        instanceUrl = mastoAcct.instance_url;
        await loadInstanceInfo(instanceUrl);
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  async function loadInstanceInfo(url: string) {
    try {
      // Try v2 first, fall back to v1
      let resp = await fetch(`${url}/api/v2/instance`);
      if (resp.ok) {
        const v2 = await resp.json();
        instance = {
          uri: v2.domain ?? url,
          title: v2.title,
          shortDescription: v2.description ?? '',
          description: v2.description ?? '',
          email: v2.contact?.email ?? '',
          version: v2.version,
          stats: {
            userCount: v2.usage?.users?.activeMonth ?? 0,
            statusCount: 0,
            domainCount: 0,
          },
          thumbnail: v2.thumbnail?.url,
          languages: v2.languages ?? [],
          registrations: v2.registrations?.enabled ?? false,
          rules: v2.rules ?? [],
          contact: v2.contact ? {
            email: v2.contact.email,
            account: v2.contact.account ? {
              acct: v2.contact.account.acct,
              displayName: v2.contact.account.display_name,
              avatar: v2.contact.account.avatar,
            } : undefined,
          } : undefined,
        };
        return;
      }

      // v1 fallback
      resp = await fetch(`${url}/api/v1/instance`);
      if (resp.ok) {
        const v1 = await resp.json();
        instance = {
          uri: v1.uri,
          title: v1.title,
          shortDescription: v1.short_description ?? '',
          description: v1.description ?? '',
          email: v1.email ?? '',
          version: v1.version,
          stats: v1.stats ?? { userCount: 0, statusCount: 0, domainCount: 0 },
          thumbnail: v1.thumbnail,
          languages: v1.languages ?? [],
          registrations: v1.registrations ?? false,
          rules: v1.rules ?? [],
          contact: v1.contact_account ? {
            email: v1.email,
            account: {
              acct: v1.contact_account.acct,
              displayName: v1.contact_account.display_name,
              avatar: v1.contact_account.avatar,
            },
          } : undefined,
        };
      }
    } catch (e) {
      error = `Failed to load instance info: ${e}`;
    }
  }

  async function loadDifferentInstance() {
    const url = prompt('Instance URL (e.g. https://mastodon.social):');
    if (!url) return;
    loading = true;
    instanceUrl = url.replace(/\/$/, '');
    if (!instanceUrl.startsWith('http')) instanceUrl = `https://${instanceUrl}`;
    await loadInstanceInfo(instanceUrl);
    loading = false;
  }
</script>

<div class="p-6 max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Server size={24} />
      <h1 class="text-2xl font-bold">Instance Info</h1>
      <span class="text-xs px-2 py-0.5 bg-[var(--color-mastodon)]/20 text-[var(--color-mastodon)] rounded">Mastodon</span>
    </div>
    <button onclick={loadDifferentInstance} class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-md px-3 py-1.5">
      <Globe size={12} /> Other instance
    </button>
  </div>

  {#if error}
    <div class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
  {/if}

  {#if loading}
    <div class="text-center py-12"><Loader2 size={32} class="text-[var(--color-text-muted)] animate-spin mx-auto" /></div>
  {:else if !instance}
    <div class="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
      <Server size={48} class="text-[var(--color-text-muted)] mx-auto mb-4" />
      <h3 class="text-lg font-medium text-[var(--color-text-muted)] mb-2">No Instance Connected</h3>
      <p class="text-sm text-[var(--color-text-muted)]">Add a Mastodon account in Settings, or click "Other instance" to view any instance.</p>
    </div>
  {:else}
    <!-- Instance header -->
    {#if instance.thumbnail}
      <div class="h-32 rounded-t-lg bg-cover bg-center -mx-6 -mt-6 mb-4" style="background-image: url({instance.thumbnail})"></div>
    {/if}

    <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden mb-6">
      <div class="p-5">
        <h2 class="text-xl font-bold">{instance.title}</h2>
        <p class="text-xs text-[var(--color-text-muted)] mt-1">
          {instance.uri} · v{instance.version} · {instance.registrations ? 'Open registrations' : 'Closed registrations'}
        </p>
        {#if instance.shortDescription}
          <p class="text-sm text-[var(--color-text)] mt-3">{instance.shortDescription}</p>
        {/if}
        {#if instance.description && instance.description !== instance.shortDescription}
          <div class="text-xs text-[var(--color-text-muted)] mt-2 prose-invert" >
            {@html instance.description}
          </div>
        {/if}
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 border-t border-[var(--color-border)]">
        <div class="p-3 text-center border-r border-[var(--color-border)]">
          <Users size={16} class="text-[var(--color-text-muted)] mx-auto mb-1" />
          <div class="text-lg font-bold">{instance.stats.userCount.toLocaleString()}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Users</div>
        </div>
        <div class="p-3 text-center border-r border-[var(--color-border)]">
          <MessageCircle size={16} class="text-[var(--color-text-muted)] mx-auto mb-1" />
          <div class="text-lg font-bold">{instance.stats.statusCount.toLocaleString()}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Posts</div>
        </div>
        <div class="p-3 text-center">
          <Globe size={16} class="text-[var(--color-text-muted)] mx-auto mb-1" />
          <div class="text-lg font-bold">{instance.stats.domainCount.toLocaleString()}</div>
          <div class="text-[10px] text-[var(--color-text-muted)]">Known instances</div>
        </div>
      </div>
    </div>

    <!-- Contact -->
    {#if instance.contact}
      <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 mb-6">
        <h3 class="text-sm font-semibold mb-3 flex items-center gap-2"><Mail size={14} /> Contact</h3>
        <div class="flex items-center gap-3">
          {#if instance.contact.account}
            <a href="/profile?handle={encodeURIComponent(instance.contact.account.acct)}&platform=mastodon" class="flex items-center gap-2 hover:underline">
              {#if instance.contact.account.avatar}
                <img src={instance.contact.account.avatar} alt="" class="w-8 h-8 rounded-full" />
              {/if}
              <div>
                <p class="text-sm font-medium">{instance.contact.account.displayName || instance.contact.account.acct}</p>
                <p class="text-xs text-[var(--color-text-muted)]">@{instance.contact.account.acct}</p>
              </div>
            </a>
          {/if}
          {#if instance.contact.email}
            <a href="mailto:{instance.contact.email}" class="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
              <Mail size={10} /> {instance.contact.email}
            </a>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Rules -->
    {#if instance.rules.length > 0}
      <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4 mb-6">
        <h3 class="text-sm font-semibold mb-3 flex items-center gap-2"><Shield size={14} /> Instance Rules ({instance.rules.length})</h3>
        <ol class="space-y-2">
          {#each instance.rules as rule, i}
            <li class="flex gap-3 text-sm">
              <span class="text-xs font-bold text-[var(--color-primary)] mt-0.5 w-5 text-right flex-shrink-0">{i + 1}.</span>
              <span class="text-[var(--color-text)]">{rule.text}</span>
            </li>
          {/each}
        </ol>
      </div>
    {/if}

    <!-- Languages -->
    {#if instance.languages.length > 0}
      <div class="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-4">
        <h3 class="text-sm font-semibold mb-2">Languages</h3>
        <div class="flex flex-wrap gap-1">
          {#each instance.languages as lang}
            <span class="text-xs px-2 py-0.5 bg-[var(--color-surface-hover)] rounded">{lang}</span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="mt-4 text-center">
      <a href={instanceUrl} target="_blank" rel="noopener noreferrer" class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] inline-flex items-center gap-1">
        <ExternalLink size={10} /> Open {instance.uri} in browser
      </a>
    </div>
  {/if}
</div>
