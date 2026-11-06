import type { UnifiedPost } from '$lib/types';
import type { ComposerSnapshot, StoredOptions } from '$lib/publishing/snapshots';

export interface PostContext {
  options: Pick<StoredOptions, 'replyTo' | 'quoteUri' | 'quoteCid' | 'quoteUrl'>;
  display: NonNullable<ComposerSnapshot['context']>;
}

/** Freeze the requested post before the composer starts accepting edits. */
export function postContext(reply: UnifiedPost | null, quote: UnifiedPost | null): PostContext {
  const options: PostContext['options'] = {};
  const display = { quoteAuthor: '', quoteText: '', replyAuthor: '' };
  if (reply) {
    const raw = reply.raw as { id?: string; reblog?: { id?: string }; cid?: string; post?: { cid?: string; record?: { reply?: { root?: { uri: string; cid: string } } } }; record?: { reply?: { root?: { uri: string; cid: string } } } } | undefined;
    const record = raw?.post ?? raw;
    const root = record?.record?.reply?.root;
    options.replyTo = {
      uri: reply.uri, platform: reply.platform,
      id: reply.platform === 'mastodon' ? raw?.reblog?.id ?? raw?.id : raw?.id,
      cid: record?.cid,
      rootUri: root?.uri, rootCid: root?.cid,
    };
    display.replyAuthor = reply.author.handle;
  } else if (quote) {
    const raw = quote.raw as { cid?: string; post?: { cid?: string } } | undefined;
    if (quote.platform === 'bluesky') {
      options.quoteUri = quote.uri;
      options.quoteCid = raw?.post?.cid ?? raw?.cid;
      const key = quote.uri.split('/').pop();
      if (key) options.quoteUrl = `https://bsky.app/profile/${quote.author.handle}/post/${key}`;
    } else if (quote.uri.startsWith('https://')) {
      options.quoteUrl = quote.uri;
    }
    display.quoteAuthor = quote.author.handle;
    display.quoteText = quote.text;
  }
  return { options, display };
}

/** Compare reply/quote identity, not the text a person has already written. */
export function postContextKey(options: PostContext['options']): string {
  if (options.replyTo) return `reply:${options.replyTo.platform ?? ''}:${options.replyTo.uri}`;
  if (options.quoteUri || options.quoteUrl) return `quote:${options.quoteUri ?? options.quoteUrl}`;
  return '';
}

/** Destination-specific text is part of a draft even when shared text is blank. */
export function hasDraftContent(saved: ComposerSnapshot): boolean {
  return !!saved.text.trim() || saved.media.length > 0 ||
    Object.values(saved.overrides).some(text => !!text.trim()) ||
    !!saved.options.mediaUrls?.some(url => !!url.trim());
}
