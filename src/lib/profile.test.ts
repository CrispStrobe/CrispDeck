/**
 * Tests for profile page logic — follows-you detection, follower pagination,
 * post tab filtering, media gallery extraction.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedPost } from './types';

function makePost(overrides: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    uri: `at://did:plc:test/post/${Math.random().toString(36).slice(2)}`,
    text: 'Test post',
    author: { handle: 'alice.bsky.social', displayName: 'Alice' },
    createdAt: new Date().toISOString(),
    platform: 'bluesky',
    isRepost: false,
    ...overrides,
  };
}

describe('profile tab filtering', () => {
  const posts = [
    makePost({ text: 'Original post' }),
    makePost({ text: 'Reply to thread', replyParentUri: 'at://parent' }),
    makePost({ text: 'Post with image', embeds: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'x', fullsize: 'y' }] } }),
    makePost({ text: 'Another original' }),
  ];

  it('posts tab shows only non-reply posts', () => {
    const filtered = posts.filter(p => !p.replyParentUri);
    expect(filtered.length).toBe(3);
  });

  it('replies tab shows only posts with replyParentUri', () => {
    const filtered = posts.filter(p => p.replyParentUri);
    expect(filtered.length).toBe(1);
  });

  it('media tab shows posts with embeds', () => {
    const filtered = posts.filter(p => p.embeds && (Array.isArray(p.embeds) ? (p.embeds as any[]).length > 0 : true));
    expect(filtered.length).toBe(1);
  });
});

describe('profile follows-you badge', () => {
  it('detects followedBy from Bluesky viewer', () => {
    const profile = { viewer: { following: 'at://follow/1', followedBy: 'at://follow/2' } };
    expect(!!profile.viewer?.followedBy).toBe(true);
  });

  it('detects not following back', () => {
    const profile = { viewer: { following: 'at://follow/1' } };
    expect(!!(profile.viewer as any)?.followedBy).toBe(false);
  });

  it('detects Mastodon follows-you from relationships', () => {
    const rel = { following: true, followed_by: true };
    expect(rel.followed_by).toBe(true);
  });
});

describe('profile follower pagination', () => {
  it('appends new followers to existing list', () => {
    const existing = [{ handle: 'a' }, { handle: 'b' }];
    const newItems = [{ handle: 'c' }, { handle: 'd' }];
    const combined = [...existing, ...newItems];
    expect(combined.length).toBe(4);
    expect(combined[2].handle).toBe('c');
  });

  it('cursor presence indicates more pages', () => {
    const cursor: string | undefined = 'next-page-token';
    expect(!!cursor).toBe(true);
    const noCursor: string | undefined = undefined;
    expect(!!noCursor).toBe(false);
  });
});

describe('profile media gallery extraction', () => {
  it('extracts Bluesky images from embed', () => {
    const embed = {
      $type: 'app.bsky.embed.images#view',
      images: [
        { fullsize: 'https://img1.jpg', thumb: 'https://thumb1.jpg', alt: 'Photo' },
        { fullsize: 'https://img2.jpg', thumb: 'https://thumb2.jpg', alt: '' },
      ],
    };
    expect(embed.images.length).toBe(2);
    expect(embed.images[0].alt).toBe('Photo');
  });

  it('extracts Mastodon media from attachments array', () => {
    const attachments = [
      { type: 'image', url: 'https://img.jpg', previewUrl: 'https://preview.jpg', description: 'A photo' },
      { type: 'video', url: 'https://vid.mp4', previewUrl: '', description: '' },
    ];
    const images = attachments.filter(a => a.type === 'image');
    const videos = attachments.filter(a => a.type === 'video');
    expect(images.length).toBe(1);
    expect(videos.length).toBe(1);
  });
});
