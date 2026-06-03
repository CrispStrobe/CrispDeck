import { RichText, BskyAgent } from '@atproto/api';
import type { BlueskyClient } from '$lib/api/bluesky';
import type { MastodonClient } from '$lib/api/mastodon';
import { resolveMentionsForPlatform } from './mentions';

export interface PostResult {
  platform: 'bluesky' | 'mastodon';
  success: boolean;
  uri?: string;
  cid?: string;
  error?: string;
}

export interface ComposeOptions {
  text: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'direct';
  contentWarning?: string;
  mediaFiles?: File[];
  altTexts?: string[];  // Alt text per media file
  quoteUri?: string;   // AT Protocol URI of quoted post
  quoteCid?: string;   // CID of quoted post
  quoteUrl?: string;   // Web URL for Mastodon (appended to text)
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
      const images: Array<{
        alt: string;
        image: { $type: string; ref: { $link: string }; mimeType: string; size: number };
      }> = [];

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
    } else if (options.quoteUri && options.quoteCid) {
      // Quote without images
      record.embed = {
        $type: 'app.bsky.embed.record',
        record: { uri: options.quoteUri, cid: options.quoteCid },
      };
    }

    const resp = await agent.api.com.atproto.repo.createRecord({
      repo: agent.session!.did,
      collection: 'app.bsky.feed.post',
      record,
    });

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

    // Upload media first if present
    const mediaIds: string[] = [];
    if (options.mediaFiles && options.mediaFiles.length > 0) {
      for (const file of options.mediaFiles.slice(0, 4)) {
        const formData = new FormData();
        formData.append('file', file);

        const mediaResp = await fetch(`${instanceUrl}/api/v2/media`, {
          method: 'POST',
          headers: authHeaders,
          body: formData,
        });

        if (!mediaResp.ok) {
          throw new Error(`Media upload failed: ${mediaResp.statusText}`);
        }

        const mediaData = await mediaResp.json();
        mediaIds.push(mediaData.id);
      }
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

/** Crosspost to multiple platforms */
export async function crosspost(
  targets: Array<{
    platform: 'bluesky' | 'mastodon';
    client: BlueskyClient | MastodonClient;
  }>,
  options: ComposeOptions,
): Promise<PostResult[]> {
  const results: PostResult[] = [];

  for (const target of targets) {
    if (target.platform === 'bluesky') {
      results.push(await postToBluesky(target.client as BlueskyClient, options));
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

/** Crosspost a thread — splits per platform's limits, posts reply chains */
export async function crosspostThread(
  targets: Array<{
    platform: 'bluesky' | 'mastodon';
    client: BlueskyClient | MastodonClient;
    parts: string[]; // Pre-split text parts for this platform
  }>,
  options: Omit<ComposeOptions, 'text'>,
): Promise<PostResult[]> {
  const results: PostResult[] = [];

  for (const target of targets) {
    // Resolve @mentions to platform-specific handles
    const resolvedParts: string[] = [];
    for (const part of target.parts) {
      resolvedParts.push(await resolveMentionsForPlatform(part, target.platform));
    }

    if (resolvedParts.length === 1) {
      // Single post, no thread needed
      if (target.platform === 'bluesky') {
        results.push(await postToBluesky(target.client as BlueskyClient, { ...options, text: resolvedParts[0] }));
      } else {
        results.push(await postToMastodon(target.client as MastodonClient, { ...options, text: resolvedParts[0] }));
      }
    } else {
      // Thread
      if (target.platform === 'bluesky') {
        results.push(...await postThreadToBluesky(target.client as BlueskyClient, resolvedParts, options));
      } else {
        results.push(...await postThreadToMastodon(target.client as MastodonClient, resolvedParts, options));
      }
    }
  }

  return results;
}

/** Get the character limit for a platform */
export function getCharLimit(platform: 'bluesky' | 'mastodon'): number {
  return platform === 'bluesky' ? 300 : 500;
}

/** Count graphemes (what Bluesky uses for character counting) */
export function graphemeLength(text: string): number {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  return [...text].length;
}
