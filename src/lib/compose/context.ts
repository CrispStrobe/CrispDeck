import type { Account, Platform, UnifiedPost } from '$lib/types';
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

/** Carry the source identity and the complete reply/quote through navigation. */
export function postContextParams(post: UnifiedPost, action: 'reply' | 'quote'): URLSearchParams {
  const { options, display } = postContext(action === 'reply' ? post : null, action === 'quote' ? post : null);
  const params = new URLSearchParams({ platform: post.platform });
  if (post.sourceAccountId !== undefined) params.set('account', String(post.sourceAccountId));
  const values = options.replyTo ? {
    replyTo: options.replyTo.uri, author: display.replyAuthor,
    replyId: options.replyTo.id, replyCid: options.replyTo.cid,
    replyRootUri: options.replyTo.rootUri, replyRootCid: options.replyTo.rootCid,
  } : {
    quoteUri: options.quoteUri, quoteCid: options.quoteCid, quoteUrl: options.quoteUrl,
    quoteAuthor: display.quoteAuthor, quoteText: display.quoteText.substring(0, 100),
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params;
}

function requestedPlatform(params: URLSearchParams, uri: string): Platform | undefined {
  const explicit = params.get('platform');
  if (explicit !== null) return explicit === 'bluesky' || explicit === 'mastodon' || explicit === 'threads' ? explicit : undefined;
  if (uri.startsWith('at://')) return 'bluesky';
  if (uri.startsWith('threads://')) return 'threads';
  try {
    const url = new URL(uri);
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    if (['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'].includes(url.hostname)) return 'threads';
    if (url.hostname === 'bsky.app') return 'bluesky';
    return 'mastodon';
  } catch { return undefined; }
}

/** Incoming post actions never inherit the default "all accounts" selection. */
export function composeContextFromParams(params: URLSearchParams, accounts: Account[]): (PostContext & { accountIds: number[] }) | null {
  const reply = params.get('replyTo') || '';
  const quote = params.get('quoteUri') || '';
  const quoteUrl = params.get('quoteUrl') || '';
  if (!reply && !quote && !quoteUrl) return null;
  const platform = requestedPlatform(params, reply || quote || quoteUrl);
  const matching = accounts.filter(account => account.platform === platform);
  const sourceId = params.get('account');
  const source = sourceId !== null && /^[1-9]\d*$/.test(sourceId) && Number.isSafeInteger(Number(sourceId))
    ? matching.find(account => account.id === Number(sourceId)) : undefined;
  const accountIds = sourceId !== null ? source ? [source.id] : [] : matching.length === 1 ? [matching[0].id] : [];
  const context: PostContext & { accountIds: number[] } = {
    options: {}, display: { replyAuthor: '', quoteAuthor: '', quoteText: '' }, accountIds,
  };
  if (reply) {
    context.options.replyTo = {
      uri: reply, platform,
      id: params.get('replyId') || undefined, cid: params.get('replyCid') || undefined,
      rootUri: params.get('replyRootUri') || undefined, rootCid: params.get('replyRootCid') || undefined,
    };
    context.display.replyAuthor = params.get('author') ?? '';
  } else {
    context.display.quoteAuthor = params.get('quoteAuthor') ?? '';
    context.display.quoteText = params.get('quoteText') ?? '';
    if (platform === 'bluesky' && quote.startsWith('at://')) {
      context.options.quoteUri = quote;
      context.options.quoteCid = params.get('quoteCid') || undefined;
    }
    // Older links used quoteUri for Mastodon too. Keep it as a web quote,
    // rather than building a bsky.app URL from a Mastodon handle and ID.
    context.options.quoteUrl = quoteUrl || (/^https?:\/\//.test(quote) ? quote : undefined);
  }
  return context;
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
