// BskyAgent was imported here and never used. RichText is loaded on demand:
// it was the only value this module took from the SDK, and taking it
// statically put all 221 KB gzipped of it in the compose route's closure.
import type { Agent, BlobRef } from '@atproto/api';
import { loadAtprotoSdk } from '$lib/api/atproto-sdk';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import { resolveMastodonReply } from './mastodon-reply';
import type { ThreadsClient } from '$lib/api/threads';
import type { Platform } from '$lib/types';
import { resolveMentionsForPlatform } from './mentions';
import { isVideoFile } from './media';
import { validateMediaForPlatform } from './media-policy';
import { readImageDimensions, type ImageDimensions } from './image-dimensions';

export interface PostResult {
  platform: Platform;
  success: boolean;
  uri?: string;
  cid?: string;
  error?: string;
  id?: string;
  uncertain?: boolean;
}

export type ThreadGate = 'everyone' | 'mentioned' | 'following' | 'nobody';

export interface ComposeOptions {
  text: string;
  deliveryKey?: string;
  recordKey?: string;
  createdAt?: string;
  replyTo?: { uri: string; cid?: string; id?: string; rootUri?: string; rootCid?: string; platform?: Platform };
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  contentWarning?: string;
  mediaFiles?: File[];
  mediaUrls?: string[]; // Publicly accessible HTTPS URLs (for Threads)
  altTexts?: string[];  // Alt text per media file
  quoteUri?: string;   // AT Protocol URI of quoted post
  quoteCid?: string;   // CID of quoted post
  quoteUrl?: string;   // Web URL for Mastodon (appended to text)
  threadGate?: ThreadGate; // Bluesky: who can reply
  selfLabel?: string;      // Bluesky: content self-label (graphic-media, nudity, porn, gore)
  disableQuotes?: boolean; // Bluesky: disable quoting via postgate
  poll?: PollOptions;      // Mastodon: attach a poll
  onVideoProgress?: (status: string) => void; // Video upload progress callback
}

export interface PollOptions {
  options: string[];        // 2-4 poll choices
  expiresIn: number;        // seconds (e.g. 86400 for 24h)
  multiple?: boolean;        // allow multiple selections
}

/** Post to Bluesky using the AT Protocol */
export async function postToBluesky(
  client: BlueskyClient,
  options: ComposeOptions,
  oauthAgent?: Agent,
): Promise<PostResult> {
  try {
    const mediaError = validateMediaForPlatform('bluesky', options.mediaFiles);
    if (mediaError) throw new Error(mediaError);
    const agent = oauthAgent ?? client.getAgent();
    const did = agent.did ?? (agent as { session?: { did?: string } }).session?.did;
    if (!did) throw new Error('Reconnect this Bluesky account before publishing.');

    // Use RichText to auto-detect facets (mentions, links, tags)
    const { RichText } = await loadAtprotoSdk();
    const rt = new RichText({ text: options.text });
    await rt.detectFacets(agent);

    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: rt.text,
      facets: rt.facets,
      createdAt: options.createdAt ?? new Date().toISOString(),
    };

    // Upload media if present
    if (options.mediaFiles && options.mediaFiles.length > 0) {
      // Validation above permits one video or images; it never drops images
      // merely because a video was also selected.
      const videoFile = options.mediaFiles.find(f => isVideoFile(f));

      if (videoFile) {
        // Video upload: only one video per post, no mixing with images
        const videoIdx = options.mediaFiles.indexOf(videoFile);
        const blobRef = await client.uploadVideo(videoFile, options.onVideoProgress, oauthAgent);

        const videoEmbed: Record<string, unknown> = {
          $type: 'app.bsky.embed.video',
          video: blobRef,
          alt: options.altTexts?.[videoIdx] ?? '',
        };

        if (options.quoteUri && options.quoteCid) {
          record.embed = {
            $type: 'app.bsky.embed.recordWithMedia',
            record: {
              $type: 'app.bsky.embed.record',
              record: { uri: options.quoteUri, cid: options.quoteCid },
            },
            media: videoEmbed,
          };
        } else {
          record.embed = videoEmbed;
        }
      } else {
        const useGallery = options.mediaFiles.length > 4;
        const dimensions: ImageDimensions[] = [];
        // Check every gallery image before uploading any blobs. Decode one at
        // a time so ten large photos do not stay resident in memory together.
        if (useGallery) {
          for (const file of options.mediaFiles) dimensions.push(await readImageDimensions(file));
        }
        const images: Array<{ alt: string; image: BlobRef }> = [];

        for (let idx = 0; idx < options.mediaFiles.length; idx++) {
          const file = options.mediaFiles[idx];
          const bytes = new Uint8Array(await file.arrayBuffer());
          const resp = await agent.uploadBlob(bytes, { encoding: file.type });
          images.push({
            alt: options.altTexts?.[idx] ?? '',
            image: resp.data.blob,
          });
        }

        const mediaEmbed = useGallery
          ? { $type: 'app.bsky.embed.gallery', items: images.map((image, index) => ({ $type: 'app.bsky.embed.gallery#image', ...image, aspectRatio: dimensions[index] })) }
          : { $type: 'app.bsky.embed.images', images };
        if (options.quoteUri && options.quoteCid) {
          // Images + quote: use recordWithMedia embed
          record.embed = {
            $type: 'app.bsky.embed.recordWithMedia',
            record: {
              $type: 'app.bsky.embed.record',
              record: { uri: options.quoteUri, cid: options.quoteCid },
            },
            media: mediaEmbed,
          };
        } else {
          record.embed = mediaEmbed;
        }
      }
    } else if (options.quoteUri && options.quoteCid) {
      // Quote without images
      record.embed = {
        $type: 'app.bsky.embed.record',
        record: { uri: options.quoteUri, cid: options.quoteCid },
      };
    }

    // Add self-label if specified (content warning for Bluesky)
    if (options.selfLabel) {
      record.labels = {
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: options.selfLabel }],
      };
    }

    if (options.replyTo?.uri && options.replyTo.cid) {
      record.reply = {
        root: { uri: options.replyTo.rootUri ?? options.replyTo.uri, cid: options.replyTo.rootCid ?? options.replyTo.cid },
        parent: { uri: options.replyTo.uri, cid: options.replyTo.cid },
      };
    }
    const repo = agent.api.com.atproto.repo;
    // A stable record key makes an interrupted outbox delivery safe to retry.
    const resp = options.recordKey
      ? await repo.putRecord({ repo: did, collection: 'app.bsky.feed.post', rkey: options.recordKey, record })
      : await repo.createRecord({ repo: did, collection: 'app.bsky.feed.post', record });

    // Create thread gate if specified
    if (options.threadGate && options.threadGate !== 'everyone') {
      const rkey = resp.data.uri.split('/').pop()!;
      const allow: Array<{ $type: string; list?: string }> = [];
      if (options.threadGate === 'mentioned') {
        allow.push({ $type: 'app.bsky.feed.threadgate#mentionRule' });
      } else if (options.threadGate === 'following') {
        allow.push({ $type: 'app.bsky.feed.threadgate#followingRule' });
      }
      // 'nobody' = empty allow array

      await (options.recordKey ? repo.putRecord.bind(repo) : repo.createRecord.bind(repo))({
        repo: did,
        collection: 'app.bsky.feed.threadgate',
        rkey,
        record: {
          $type: 'app.bsky.feed.threadgate',
          post: resp.data.uri,
          createdAt: new Date().toISOString(),
          allow,
        },
      });
    }

    // Create post gate if quoting disabled
    if (options.disableQuotes) {
      const rkey = resp.data.uri.split('/').pop()!;
      await (options.recordKey ? repo.putRecord.bind(repo) : repo.createRecord.bind(repo))({
        repo: did,
        collection: 'app.bsky.feed.postgate',
        rkey,
        record: {
          $type: 'app.bsky.feed.postgate',
          post: resp.data.uri,
          createdAt: new Date().toISOString(),
          embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        },
      });
    }

    return {
      platform: 'bluesky',
      success: true,
      uri: resp.data.uri,
      cid: resp.data.cid,
    };
  } catch (e) {
    return {
      platform: 'bluesky',
      success: false,
      error: String(e),
    };
  }
}

/** Post to Mastodon via its REST API */
export async function postToMastodon(
  client: MastodonClient,
  options: ComposeOptions,
): Promise<PostResult> {
  let writeStarted = false;
  let confirmedRejected = false;
  try {
    const mediaError = validateMediaForPlatform('mastodon', options.mediaFiles);
    if (mediaError) throw new Error(mediaError);
    const instanceUrl = client.getInstanceUrl();
    const token = client.getAccessToken();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const replyId = options.replyTo ? await resolveMastodonReply(client, options.replyTo) : undefined;

    // Upload media in parallel (most Mastodon servers handle 4 concurrent uploads)
    const mediaIds: string[] = [];
    if (options.mediaFiles && options.mediaFiles.length > 0) {
      const uploadResults = await Promise.all(
        options.mediaFiles.map(async (file, idx) => {
          const formData = new FormData();
          formData.append('file', file);
          if (options.altTexts?.[idx]) formData.append('description', options.altTexts[idx]);

          const mediaResp = await fetch(`${instanceUrl}/api/v2/media`, {
            method: 'POST',
            headers: authHeaders,
            body: formData,
          });

          if (!mediaResp.ok) {
            throw new Error(`Media upload failed: ${mediaResp.statusText}`);
          }

          return (await mediaResp.json()).id as string;
        })
      );
      mediaIds.push(...uploadResults);
    }

    // Create the status
    const body: Record<string, unknown> = {
      status: options.quoteUrl ? `${options.text}\n\n${options.quoteUrl}` : options.text,
      visibility: options.visibility ?? 'public',
    };

    if (replyId) body.in_reply_to_id = replyId;

    if (mediaIds.length > 0) {
      body.media_ids = mediaIds;
    }

    if (options.contentWarning) {
      body.spoiler_text = options.contentWarning;
    }

    if (options.poll && options.poll.options.length >= 2) {
      body.poll = {
        options: options.poll.options,
        expires_in: options.poll.expiresIn,
        multiple: options.poll.multiple ?? false,
      };
    }

    writeStarted = true;
    const resp = await fetch(`${instanceUrl}/api/v1/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...(options.deliveryKey ? { 'Idempotency-Key': options.deliveryKey } : {}) },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      confirmedRejected = true;
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Status creation failed: ${resp.statusText}`);
    }

    const status = await resp.json();
    return {
      platform: 'mastodon',
      success: true,
      uri: status.url || status.uri,
      id: String(status.id),
    };
  } catch (e) {
    return {
      platform: 'mastodon',
      success: false,
      error: String(e),
      uncertain: writeStarted && !confirmedRejected,
    };
  }
}

/** Post to Threads using the container-then-publish flow */
export async function postToThreads(
  client: ThreadsClient,
  options: ComposeOptions,
): Promise<PostResult> {
  let publishing = false;
  try {
    const mediaError = validateMediaForPlatform('threads', options.mediaFiles, options.mediaUrls);
    if (mediaError) throw new Error(mediaError);
    let containerId: string;

    // Check for media URLs (Threads requires publicly accessible HTTPS URLs)
    const mediaUrls = options.mediaUrls;

    if (mediaUrls && mediaUrls.length > 1) {
      // Carousel (multiple images)
      const childIds: string[] = [];
      for (const url of mediaUrls) {
        const isVideo = /\.(mp4|mov|webm)(?:[?#]|$)/i.test(url);
        const id = await client.createCarouselItemContainer(isVideo ? 'VIDEO' : 'IMAGE', url);
        await client.waitForContainer(id);
        childIds.push(id);
      }
      containerId = await client.createCarouselContainer(childIds, options.text, options.replyTo?.id);
    } else if (mediaUrls && mediaUrls.length === 1) {
      // Single image or video
      const url = mediaUrls[0];
      const isVideo = /\.(mp4|mov|webm)(?:[?#]|$)/i.test(url);
      containerId = isVideo
        ? await client.createVideoContainer(url, options.text, options.replyTo?.id)
        : await client.createImageContainer(url, options.text, options.replyTo?.id);
    } else {
      // Text-only
      containerId = await client.createTextContainer(options.text, options.replyTo?.id);
    }

    await client.waitForContainer(containerId);
    publishing = true;
    const result = await client.publishContainer(containerId);
    publishing = false;
    let permalink: string | undefined;
    try { permalink = (await client.getPost(result.id)).permalink; } catch { /* the post is already published */ }

    return {
      platform: 'threads',
      success: true,
      uri: permalink,
      id: String(result.id),
    };
  } catch (e) {
    return {
      platform: 'threads',
      success: false,
      error: String(e),
      uncertain: publishing,
    };
  }
}

/** Crosspost to multiple platforms */
export async function crosspost(
  targets: Array<{
    platform: Platform;
    client: BlueskyClient | MastodonClient | ThreadsClient;
  }>,
  options: ComposeOptions,
): Promise<PostResult[]> {
  const results: PostResult[] = [];

  for (const target of targets) {
    if (target.platform === 'bluesky') {
      results.push(await postToBluesky(target.client as BlueskyClient, options));
    } else if (target.platform === 'threads') {
      results.push(await postToThreads(target.client as ThreadsClient, options));
    } else {
      results.push(await postToMastodon(target.client as MastodonClient, options));
    }
  }

  return results;
}

/** Shared first-part rules keep thread publishing on the validated media path. */
function threadPartOptions(options: Omit<ComposeOptions, 'text'>, text: string, index: number): ComposeOptions {
  return {
    ...options, text,
    deliveryKey: options.deliveryKey ? `${options.deliveryKey}-${index}` : undefined,
    recordKey: options.recordKey ? (index === 0 ? options.recordKey : `${options.recordKey}-${index}`) : undefined,
    mediaFiles: index === 0 ? options.mediaFiles : undefined,
    mediaUrls: index === 0 ? options.mediaUrls : undefined,
    quoteUri: index === 0 ? options.quoteUri : undefined,
    quoteCid: index === 0 ? options.quoteCid : undefined,
    quoteUrl: index === 0 ? options.quoteUrl : undefined,
    poll: index === 0 ? options.poll : undefined,
    threadGate: index === 0 ? options.threadGate : undefined,
  };
}

/** Post a thread (reply chain) to Bluesky, retaining all first-post media. */
export async function postThreadToBluesky(client: BlueskyClient, parts: string[], options: Omit<ComposeOptions, 'text'>): Promise<PostResult[]> {
  const results: PostResult[] = [];
  let rootUri = options.replyTo?.rootUri ?? options.replyTo?.uri;
  let rootCid = options.replyTo?.rootCid ?? options.replyTo?.cid;
  for (let index = 0; index < parts.length; index++) {
    const previous = results[index - 1];
    const part = threadPartOptions(options, parts[index], index);
    if (previous?.uri && previous.cid) part.replyTo = { uri: previous.uri, cid: previous.cid, rootUri, rootCid, platform: 'bluesky' };
    const result = await postToBluesky(client, part);
    results.push(result);
    if (!result.success) break;
    rootUri ??= result.uri; rootCid ??= result.cid;
  }
  return results;
}

/** Post a thread (reply chain) to Mastodon using the same validation as a post. */
export async function postThreadToMastodon(client: MastodonClient, parts: string[], options: Omit<ComposeOptions, 'text'>): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (let index = 0; index < parts.length; index++) {
    const previous = results[index - 1];
    const part = threadPartOptions(options, parts[index], index);
    if (previous?.id) part.replyTo = { uri: previous.uri ?? '', id: previous.id, platform: 'mastodon' };
    const result = await postToMastodon(client, part);
    results.push(result);
    if (!result.success) break;
  }
  return results;
}

/** Post a thread (reply chain) to Threads without dropping the first-post media. */
export async function postThreadToThreads(client: ThreadsClient, parts: string[], options: Omit<ComposeOptions, 'text'> = {}): Promise<PostResult[]> {
  const results: PostResult[] = [];
  for (let index = 0; index < parts.length; index++) {
    const previous = results[index - 1];
    const part = threadPartOptions(options, parts[index], index);
    if (previous?.id) part.replyTo = { uri: previous.uri ?? '', id: previous.id, platform: 'threads' };
    const result = await postToThreads(client, part);
    results.push(result);
    if (!result.success) break;
  }
  return results;
}

/** Crosspost a thread — splits per platform's limits, posts reply chains */
export async function crosspostThread(
  targets: Array<{
    platform: Platform;
    client: BlueskyClient | MastodonClient | ThreadsClient;
    parts: string[]; // Pre-split text parts for this platform
  }>,
  options: Omit<ComposeOptions, 'text'>,
): Promise<PostResult[]> {
  // Resolve mentions for all platforms in parallel
  const resolved = await Promise.all(targets.map(async (target) => ({
    ...target,
    resolvedParts: await Promise.all(
      target.parts.map(part => resolveMentionsForPlatform(part, target.platform))
    ),
  })));

  // Post to all platforms in parallel
  const platformResults = await Promise.allSettled(resolved.map(async (target) => {
    if (target.resolvedParts.length === 1) {
      if (target.platform === 'bluesky') {
        return [await postToBluesky(target.client as BlueskyClient, { ...options, text: target.resolvedParts[0] })];
      } else if (target.platform === 'threads') {
        return [await postToThreads(target.client as ThreadsClient, { ...options, text: target.resolvedParts[0] })];
      } else {
        return [await postToMastodon(target.client as MastodonClient, { ...options, text: target.resolvedParts[0] })];
      }
    } else {
      if (target.platform === 'bluesky') {
        return await postThreadToBluesky(target.client as BlueskyClient, target.resolvedParts, options);
      } else if (target.platform === 'threads') {
        return await postThreadToThreads(target.client as ThreadsClient, target.resolvedParts, options);
      } else {
        return await postThreadToMastodon(target.client as MastodonClient, target.resolvedParts, options);
      }
    }
  }));

  // Flatten results, converting rejected promises to error results
  const results: PostResult[] = [];
  for (let i = 0; i < platformResults.length; i++) {
    const r = platformResults[i];
    if (r.status === 'fulfilled') {
      results.push(...r.value);
    } else {
      results.push({ platform: resolved[i].platform, success: false, error: String(r.reason) });
    }
  }

  return results;
}

/** Get the character limit for a platform */
export function getCharLimit(platform: Platform): number {
  if (platform === 'bluesky') return 300;
  return 500; // mastodon + threads
}

/** Count graphemes (what Bluesky uses for character counting) */
export function graphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  return [...text].length;
}
