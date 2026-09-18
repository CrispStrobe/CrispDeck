/**
 * Reading Bluesky embed views.
 *
 * An embed arrives as a tagged union, and the same content can sit at two
 * depths: directly on the post, or nested inside a recordWithMedia view when
 * the post both quotes something and carries media. Every accessor here has to
 * check both, which is the part that is easy to get wrong.
 *
 * These lived inside Post.svelte, where they could not be imported, so the
 * tests kept their own copies and passed regardless of what the component did.
 */

/** Images, whether attached directly or alongside a quote. */
export function getBskyImages(embeds: unknown): any[] {
  if (!embeds) return [];
  const embed = embeds as any;
  if (embed.$type === 'app.bsky.embed.images#view' && embed.images) {
    return embed.images;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.images#view' && embed.media.images) {
      return embed.media.images;
    }
  }
  return [];
}

/** External link card, direct or alongside a quote. */
export function getBskyExternal(embeds: unknown): any | null {
  if (!embeds) return null;
  const embed = embeds as any;
  if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
    return embed.external;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.external#view' && embed.media.external) {
      return embed.media.external;
    }
  }
  return null;
}

/**
 * The quoted post, if there is one.
 *
 * Note the extra hop: a direct quote is `embed.record`, but inside
 * recordWithMedia it is `embed.record.record`.
 */
export function getBskyQuote(embeds: unknown): any | null {
  if (!embeds) return null;
  const embed = embeds as any;
  if (embed.$type === 'app.bsky.embed.record#view' && embed.record) {
    const rec = embed.record;
    if (rec.$type === 'app.bsky.embed.record#viewRecord') return rec;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.record) {
    const rec = embed.record?.record;
    if (rec?.$type === 'app.bsky.embed.record#viewRecord') return rec;
  }
  return null;
}

/** Video, direct or alongside a quote. */
export function getBskyVideo(embeds: unknown): any | null {
  if (!embeds) return null;
  const embed = embeds as any;
  if (embed.$type === 'app.bsky.embed.video#view') return embed;
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.$type === 'app.bsky.embed.video#view') return embed.media;
  }
  return null;
}

/**
 * Mastodon (and Threads) media attachments, normalised for the template.
 *
 * Two shapes reach this: the masto library's camelCase and a raw fetch's
 * snake_case. A boost carries its media on `reblog`, not on the wrapper.
 * `embeds` takes precedence because normalizePost already put the attachments
 * there for some paths.
 */
export function getMastodonMedia(embeds: unknown, raw: unknown): any[] {
  const source0 = embeds;
  const r = (raw ?? {}) as any;
  const target = r.reblog ?? r;
  const sources = [source0, target.mediaAttachments ?? target.media_attachments];
  for (const source of sources) {
    if (Array.isArray(source) && source.length > 0) {
      return source
        .filter((item: any) => item && (item.type === 'image' || item.type === 'video' || item.type === 'gifv'))
        .map((item: any) => ({
          ...item,
          previewUrl: item.previewUrl ?? item.preview_url,
          remoteUrl: item.remoteUrl ?? item.remote_url,
        }));
    }
  }
  return [];
}

/**
 * Mastodon link card, or null.
 *
 * Suppressed when the post has media, because the images take the space.
 */
export function getMastodonCard(raw: unknown): any | null {
  const r = (raw ?? {}) as any;
  const target = r.reblog ?? r;
  const card = target.card ?? target.preview_card;
  if (!card || !card.url) return null;
  const media = target.mediaAttachments ?? target.media_attachments ?? [];
  if (Array.isArray(media) && media.length > 0) return null;
  return { ...card, provider_name: card.provider_name ?? card.providerName };
}
