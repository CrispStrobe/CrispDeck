import type { UnifiedPost } from '$lib/types';
import { isTauri } from '$lib/platform';

function triggerDownload(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportAsJson(posts: UnifiedPost[], handle: string) {
  const data = JSON.stringify({
    user: handle,
    exportDate: new Date().toISOString(),
    postCount: posts.length,
    posts: posts.map(p => ({
      uri: p.uri, platform: p.platform, text: p.text,
      author: p.author, createdAt: p.createdAt,
      likeCount: p.likeCount, repostCount: p.repostCount, replyCount: p.replyCount,
      isRepost: p.isRepost, repostAuthor: p.repostAuthor,
    })),
  }, null, 2);
  triggerDownload(data, 'application/json', `posts-${handle}-${Date.now()}.json`);
}

export function exportAsCsv(posts: UnifiedPost[], handle: string) {
  const headers = ['uri', 'platform', 'author_handle', 'text', 'likes', 'reposts', 'replies', 'createdAt', 'is_repost'];
  const escape = (field: unknown): string => {
    if (field === undefined || field === null) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = posts.map(p => [
    p.uri, p.platform, p.author.handle, escape(p.text),
    p.likeCount ?? 0, p.repostCount ?? 0, p.replyCount ?? 0,
    p.createdAt, p.isRepost,
  ].join(','));
  triggerDownload([headers.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8;', `posts-${handle}-${Date.now()}.csv`);
}

export function exportAsMarkdown(posts: UnifiedPost[], handle: string) {
  const title = `# Post Archive for ${handle}\n\nExported on ${new Date().toUTCString()}\n\n---\n\n`;
  const body = posts.map(p => {
    let md = `### @${p.author.handle} on ${new Date(p.createdAt).toLocaleString()}\n\n`;
    md += `${p.text.replace(/^/gm, '> ')}\n\n`;
    const url = getPostUrl(p);
    md += `Likes: ${p.likeCount ?? 0} | Reposts: ${p.repostCount ?? 0} | [Original](${url})\n\n---\n`;
    return md;
  }).join('\n');
  triggerDownload(title + body, 'text/markdown;charset=utf-8;', `posts-${handle}-${Date.now()}.md`);
}

function getPostUrl(p: UnifiedPost): string {
  if (p.platform === 'mastodon') return p.uri;
  const rkey = p.uri.split('/').pop();
  return `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;
}
