import { RichText, BskyAgent, type BlobRef } from '@atproto/api';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import type { ThreadsClient } from '$lib/api/threads';
import type { Platform } from '$lib/types';
import { resolveMentionsForPlatform } from './mentions';
import { isVideoFile } from './media';

export interface PostResult {
  platform: Platform;
  success: boolean;
  uri?: string;
  cid?: string;
  error?: string;
}

export type ThreadGate = 'everyone' | 'mentioned' | 'following' | 'nobody';

export interface ComposeOptions {
  text: string;
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
): Promise<PostResult> {
  try {
    const agent = client.getAgent();

    // Use RichText to auto-detect facets (mentions, links, tags)
    const rt = new RichText({ text: options.text });
    await rt.detectFacets(agent);

    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };

    // Upload media if present
    if (options.mediaFiles && options.mediaFiles.length > 0) {
      // Check if any file is a video — video takes priority over images
      const videoFile = options.mediaFiles.find(f => isVideoFile(f));

      if (videoFile) {
        // Video upload: only one video per post, no mixing with images
        const videoIdx = options.mediaFiles.indexOf(videoFile);
        const blobRef = await client.uploadVideo(videoFile, options.onVideoProgress);

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
        // Image upload (existing logic)
        // uploadBlob hands back a BlobRef instance; the hand-written shape here
        // described its *serialized* form, which the SDK only produces when it
        // encodes the record.
        const images: Array<{ alt: string; image: BlobRef }> = [];

        for (let idx = 0; idx < Math.min(options.mediaFiles.length, 4); idx++) {
          const file = options.mediaFiles[idx];
          const bytes = new Uint8Array(await file.arrayBuffer());
          const resp = await agent.uploadBlob(bytes, { encoding: file.type });
          images.push({
            alt: options.altTexts?.[idx] ?? '',
            image: resp.data.blob,
          });
        }

        if (options.quoteUri && options.quoteCid) {
          // Images + quote: use recordWithMedia embed
          record.embed = {
            $type: 'app.bsky.embed.recordWithMedia',
            record: {
              $type: 'app.bsky.embed.record',
              record: { uri: options.quoteUri, cid: options.quoteCid },
            },
            media: {
              $type: 'app.bsky.embed.images',
              images,
            },
          };
        } else {
          record.embed = {
            $type: 'app.bsky.embed.images',
            images,
          };
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

    const resp = await agent.api.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: 'app.bsky.feed.post',
      record,
    });

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

      await agent.api.com.atproto.repo.createRecord({
        repo: agent.session!.did,
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
      await agent.api.com.atproto.repo.createRecord({
        repo: agent.session!.did,
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
  try {
    const instanceUrl = client.getInstanceUrl();
    const token = client.getAccessToken();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    // Upload media in parallel (most Mastodon servers handle 4 concurrent uploads)
    const mediaIds: string[] = [];
    if (options.mediaFiles && options.mediaFiles.length > 0) {
      const uploadResults = await Promise.all(
        options.mediaFiles.slice(0, 4).map(async (file, idx) => {
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

    const resp = await fetch(`${instanceUrl}/api/v1/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Status creation failed: ${resp.statusText}`);
    }

    const status = await resp.json();
    return {
      platform: 'mastodon',
      success: true,
      uri: status.uri || status.url,
    };
  } catch (e) {
    return {
      platform: 'mastodon',
      success: false,
      error: String(e),
    };
  }
}

/** Post to Threads using the container-then-publish flow */
export async function postToThreads(
  client: ThreadsClient,
  options: ComposeOptions,
): Promise<PostResult> {
  try {
    let containerId: string;

    // Check for media URLs (Threads requires publicly accessible HTTPS URLs)
    const mediaUrls = options.mediaUrls?.filter(u => u.startsWith('https://'));

    if (mediaUrls && mediaUrls.length > 1) {
      // Carousel (multiple images)
      const childIds: string[] = [];
      for (const url of mediaUrls.slice(0, 10)) {
        const isVideo = /\.(mp4|mov)$/i.test(url);
        const id = await client.createCarouselItemContainer(isVideo ? 'VIDEO' : 'IMAGE', url);
        await client.waitForContainer(id);
        childIds.push(id);
      }
      containerId = await client.createCarouselContainer(childIds, options.text);
    } else if (mediaUrls && mediaUrls.length === 1) {
      // Single image or video
      const url = mediaUrls[0];
      const isVideo = /\.(mp4|mov)$/i.test(url);
      containerId = isVideo
        ? await client.createVideoContainer(url, options.text)
        : await client.createImageContainer(url, options.text);
    } else {
      // Text-only
      containerId = await client.createTextContainer(options.text);
    }

    await client.waitForContainer(containerId);
    const result = await client.publishContainer(containerId);

    return {
      platform: 'threads',
      success: true,
      uri: `https://www.threads.net/post/${result.id}`,
    };
  } catch (e) {
    return {
      platform: 'threads',
      success: false,
      error: String(e),
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

/** Post a thread (reply chain) to Bluesky */
export async function postThreadToBluesky(
  client: BlueskyClient,
  parts: string[],
  options: Omit<ComposeOptions, 'text'>,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  let parentUri: string | undefined;
  let parentCid: string | undefined;
  let rootUri: string | undefined;
  let rootCid: string | undefined;

  const agent = client.getAgent();

  for (let i = 0; i < parts.length; i++) {
    try {
      const rt = new RichText({ text: parts[i] });
      await rt.detectFacets(agent);

      const record: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      };

      // First post gets media, rest are text-only
      if (i === 0 && options.mediaFiles && options.mediaFiles.length > 0) {
        const images: Array<{
          alt: string;
          image: unknown;
        }> = [];
        for (let idx = 0; idx < Math.min(options.mediaFiles.length, 4); idx++) {
          const file = options.mediaFiles[idx];
          const bytes = new Uint8Array(await file.arrayBuffer());
          const resp = await agent.uploadBlob(bytes, { encoding: file.type });
          images.push({ alt: options.altTexts?.[idx] ?? '', image: resp.data.blob });
        }
        record.embed = { $type: 'app.bsky.embed.images', images };
      }

      // Reply chain
      if (parentUri && parentCid && rootUri && rootCid) {
        record.reply = {
          root: { uri: rootUri, cid: rootCid },
          parent: { uri: parentUri, cid: parentCid },
        };
      }

      const resp = await agent.api.com.atproto.repo.createRecord({
        repo: agent.session!.did,
        collection: 'app.bsky.feed.post',
        record,
      });

      if (i === 0) {
        rootUri = resp.data.uri;
        rootCid = resp.data.cid;
      }
      parentUri = resp.data.uri;
      parentCid = resp.data.cid;

      results.push({
        platform: 'bluesky',
        success: true,
        uri: resp.data.uri,
        cid: resp.data.cid,
      });
    } catch (e) {
      results.push({ platform: 'bluesky', success: false, error: `Part ${i + 1}: ${e}` });
      break; // Stop the chain on failure
    }
  }
  return results;
}

/** Post a thread (reply chain) to Mastodon */
export async function postThreadToMastodon(
  client: MastodonClient,
  parts: string[],
  options: Omit<ComposeOptions, 'text'>,
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  let inReplyToId: string | undefined;

  const instanceUrl = client.getInstanceUrl();
  const token = client.getAccessToken();
  const authHeaders: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  for (let i = 0; i < parts.length; i++) {
    try {
      const body: Record<string, unknown> = {
        status: parts[i],
        visibility: options.visibility ?? 'public',
      };

      if (inReplyToId) {
        body.in_reply_to_id = inReplyToId;
      }

      // First post gets media
      if (i === 0 && options.mediaFiles && options.mediaFiles.length > 0) {
        const mediaIds: string[] = [];
        for (const file of options.mediaFiles.slice(0, 4)) {
          const formData = new FormData();
          formData.append('file', file);
          const mediaResp = await fetch(`${instanceUrl}/api/v2/media`, {
            method: 'POST',
            headers: authHeaders,
            body: formData,
          });
          if (!mediaResp.ok) throw new Error(`Media upload failed: ${mediaResp.statusText}`);
          const mediaData = await mediaResp.json();
          mediaIds.push(mediaData.id);
        }
        body.media_ids = mediaIds;
      }

      if (i === 0 && options.contentWarning) {
        body.spoiler_text = options.contentWarning;
      }

      const resp = await fetch(`${instanceUrl}/api/v1/statuses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Status creation failed: ${resp.statusText}`);
      }

      const status = await resp.json();
      inReplyToId = status.id;

      results.push({
        platform: 'mastodon',
        success: true,
        uri: status.uri || status.url,
      });
    } catch (e) {
      results.push({ platform: 'mastodon', success: false, error: `Part ${i + 1}: ${e}` });
      break;
    }
  }
  return results;
}

/** Post a thread (reply chain) to Threads */
export async function postThreadToThreads(
  client: ThreadsClient,
  parts: string[],
): Promise<PostResult[]> {
  const results: PostResult[] = [];
  let parentId: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    try {
      const result = await client.publishText(parts[i], parentId);
      parentId = result.id;

      results.push({
        platform: 'threads',
        success: true,
        uri: `https://www.threads.net/post/${result.id}`,
      });
    } catch (e) {
      results.push({ platform: 'threads', success: false, error: `Part ${i + 1}: ${e}` });
      break;
    }
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
        return await postThreadToThreads(target.client as ThreadsClient, target.resolvedParts);
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
