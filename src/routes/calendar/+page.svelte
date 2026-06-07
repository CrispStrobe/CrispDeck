<script lang="ts">
  import { onMount } from 'svelte';
  import { searchArchive } from '$lib/archive';
  import { listDrafts } from '$lib/db';
  import { i18n } from '$lib/i18n.svelte';
  import { Calendar, ChevronLeft, ChevronRight, Loader2 } from '@lucide/svelte';
  import type { Draft } from '$lib/types';

  interface CalendarPost {
    text: string;
    platform: string;
    date: string;
    type: 'published' | 'scheduled';
    uri?: string;
  }

  let loading = $state(true);
  let posts: CalendarPost[] = $state([]);
  let year = $state(new Date().getFullYear());
  let month = $state(new Date().getMonth()); // 0-indexed

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  onMount(async () => {
    try {
      // Load archived posts
      const archived = await searchArchive({ type: 'post', limit: 5000 });
      for (const entry of archived) {
        posts.push({
          text: entry.text?.substring(0, 100) ?? '',
          platform: entry.platform,
          date: entry.created_at,
          type: 'published',
          uri: entry.uri,
        });
      }

      // Load scheduled drafts
      const drafts = await listDrafts();
      for (const draft of drafts) {
        if (draft.scheduled_at && !draft.is_sent) {
          posts.push({
            text: draft.text.substring(0, 100),
            platform: 'scheduled',
            date: draft.scheduled_at,
            type: 'scheduled',
          });
        }
      }
    } catch {} finally { loading = false; }
  });

  function prevMonth() {
    if (month === 0) { month = 11; year--; }
    else month--;
  }
  function nextMonth() {
    if (month === 11) { month = 0; year++; }
    else month++;
  }

  function getDaysInMonth(y: number, m: number): number {
    return new Date(y, m + 1, 0).getDate();
  }
  function getFirstDayOfWeek(y: number, m: number): number {
    return new Date(y, m, 1).getDay();
  }

  function postsOnDay(day: number): CalendarPost[] {
    return posts.filter(p => {
      const d = new Date(p.date);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });
  }

  const daysInMonth = $derived(getDaysInMonth(year, month));
  const firstDay = $derived(getFirstDayOfWeek(year, month));
  const today = new Date();
  const isCurrentMonth = $derived(year === today.getFullYear() && month === today.getMonth());

  let selectedDay: number | null = $state(null);
  const selectedPosts = $derived(selectedDay ? postsOnDay(selectedDay) : []);
</script>

<svelte:head><title>CrispDeck — {i18n.t.nav.calendar}</title></svelte:head>

<div class="p-6 max-w-5xl mx-auto">
  <div class="flex items-center justify-between mb-6">
    <div class="flex items-center gap-2">
      <Calendar size={24} />
      <h1 class="text-2xl font-bold">{i18n.t.nav.calendar}</h1>
    </div>
    <div class="flex items-center gap-3">
      <button onclick={prevMonth} class="p-1.5 hover:bg-[var(--color-surface-hover)] rounded"><ChevronLeft size={18} /></button>
      <span class="text-sm font-medium w-32 text-center">{monthNames[month]} {year}</span>
      <button onclick={nextMonth} class="p-1.5 hover:bg-[var(--color-surface-hover)] rounded"><ChevronRight size={18} /></button>
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <Loader2 size={32} class="animate-spin text-[var(--color-primary)]" />
    </div>
  {:else}
    <!-- Calendar grid -->
    <div class="grid grid-cols-7 gap-px bg-[var(--color-border)] rounded-lg overflow-hidden border border-[var(--color-border)]">
      <!-- Day headers -->
      {#each dayNames as day}
        <div class="bg-[var(--color-surface)] p-2 text-center text-xs font-medium text-[var(--color-text-muted)]">{day}</div>
      {/each}

      <!-- Empty cells before first day -->
      {#each Array(firstDay) as _}
        <div class="bg-[var(--color-bg)] p-2 min-h-[80px]"></div>
      {/each}

      <!-- Day cells -->
      {#each Array(daysInMonth) as _, i}
        {@const day = i + 1}
        {@const dayPosts = postsOnDay(day)}
        {@const isToday = isCurrentMonth && day === today.getDate()}
        <button
          onclick={() => selectedDay = selectedDay === day ? null : day}
          class="bg-[var(--color-bg)] p-2 min-h-[80px] text-left hover:bg-[var(--color-surface)] transition-colors {selectedDay === day ? 'ring-2 ring-[var(--color-primary)]' : ''}"
        >
          <span class="text-xs font-medium {isToday ? 'bg-[var(--color-primary)] text-white px-1.5 py-0.5 rounded-full' : 'text-[var(--color-text-muted)]'}">{day}</span>
          {#if dayPosts.length > 0}
            <div class="mt-1 space-y-0.5">
              {#each dayPosts.slice(0, 3) as post}
                <div class="flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background: {post.type === 'scheduled' ? 'var(--color-primary)' : `var(--color-${post.platform})`}"></span>
                  <span class="text-[9px] text-[var(--color-text-muted)] truncate">{post.text.substring(0, 25)}</span>
                </div>
              {/each}
              {#if dayPosts.length > 3}
                <span class="text-[9px] text-[var(--color-text-muted)]">+{dayPosts.length - 3} more</span>
              {/if}
            </div>
          {/if}
        </button>
      {/each}
    </div>

    <!-- Selected day detail -->
    {#if selectedDay && selectedPosts.length > 0}
      <div class="mt-4 p-4 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)]">
        <h3 class="text-sm font-semibold mb-3">{monthNames[month]} {selectedDay}, {year} — {selectedPosts.length} post{selectedPosts.length > 1 ? 's' : ''}</h3>
        <div class="space-y-2">
          {#each selectedPosts as post}
            <div class="flex items-start gap-2 p-2 bg-[var(--color-bg)] rounded">
              <span class="w-2 h-2 rounded-full flex-shrink-0 mt-1" style="background: {post.type === 'scheduled' ? 'var(--color-primary)' : `var(--color-${post.platform})`}"></span>
              <div class="min-w-0">
                <p class="text-xs text-[var(--color-text)]">{post.text}</p>
                <p class="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  {post.type === 'scheduled' ? 'Scheduled' : post.platform} · {new Date(post.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>
