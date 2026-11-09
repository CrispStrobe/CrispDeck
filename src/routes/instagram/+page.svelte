<script lang="ts">
  import InstagramTimeline from '$lib/components/InstagramTimeline.svelte';
  import { i18n } from '$lib/i18n.svelte';
</script>

<svelte:head>
  <title>{i18n.t.instagram.title} — CrispDeck</title>
  <meta name="description" content={i18n.t.instagram.subtitle} />
</svelte:head>

<InstagramTimeline />
