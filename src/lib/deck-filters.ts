import type { UnifiedPost } from './types';
import type { NotificationGroup } from './notification-grouping';
import { applyColumnMuteFilter } from './column-mute';

/** Persisted, local column filters. These never change the server query. */
export interface DeckColumnFilters {
  searchTerm?: string;
  excludeText?: string;
  author?: string;
  language?: string;
  hasMedia?: boolean;
  hideReplies?: boolean;
  hideReposts?: boolean;
  minLikes?: number;
  minReposts?: number;
  notificationTypes?: string[];
}

function contains(value: string | undefined, query: string): boolean {
  return (value ?? '').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
}

/** Link cards and quoted text alone are not image/video attachments. */
export function postHasMedia(post: UnifiedPost): boolean {
  const embed = post.embeds as any;
  if (Array.isArray(embed)) return embed.some(item => ['image', 'video', 'gifv', 'audio'].includes(item.type));
  if (!embed || typeof embed !== 'object') return false;
  if (embed.media) return postHasMedia({ ...post, embeds: embed.media });
  if (embed.$type?.startsWith('app.bsky.embed.gallery')) return Array.isArray(embed.items) && embed.items.some((item: any) => item.image || item.fullsize || item.thumbnail);
  return (Array.isArray(embed.images) && embed.images.length > 0) || !!embed.video || !!embed.playlist;
}

export function filterColumnPosts(posts: UnifiedPost[], filters: DeckColumnFilters = {}, muteWords: string[] = []): UnifiedPost[] {
  return applyColumnMuteFilter(posts, muteWords).filter(post => {
    if (filters.searchTerm && !contains(`${post.text}\n${post.author.handle}\n${post.author.displayName ?? ''}`, filters.searchTerm)) return false;
    if (filters.excludeText && filters.excludeText.split(',').some(term => term.trim() && contains(post.text, term))) return false;
    if (filters.author && !contains(post.author.handle.replace(/^@/, ''), filters.author.replace(/^@/, ''))) return false;
    if (filters.hasMedia && !postHasMedia(post)) return false;
    if (filters.hideReplies && post.replyParentUri) return false;
    if (filters.hideReposts && post.isRepost) return false;
    if ((post.likeCount ?? 0) < (filters.minLikes ?? 0)) return false;
    if ((post.repostCount ?? 0) < (filters.minReposts ?? 0)) return false;
    if (filters.language?.trim()) {
      const raw = post.raw as any;
      const languages: string[] = raw?.post?.record?.langs ?? raw?.record?.langs ?? (raw?.language ? [raw.language] : []);
      const language = filters.language.trim().toLowerCase();
      if (!languages.some(value => value.toLowerCase() === language || value.toLowerCase().startsWith(`${language}-`))) return false;
    }
    return true;
  });
}

export function filterColumnNotifications(groups: NotificationGroup[], filters: DeckColumnFilters = {}, muteWords: string[] = []): NotificationGroup[] {
  return groups.filter(group => {
    if (filters.notificationTypes && !filters.notificationTypes.includes(group.type)) return false;
    const actors = group.actors.map(actor => `${actor.handle} ${actor.displayName ?? ''}`).join(' ');
    if (filters.author && !contains(actors, filters.author.replace(/^@/, ''))) return false;
    if (filters.searchTerm && !contains(`${group.text ?? ''} ${actors}`, filters.searchTerm)) return false;
    if (filters.excludeText && filters.excludeText.split(',').some(term => term.trim() && contains(group.text, term))) return false;
    return applyColumnMuteFilter([{ text: group.text ?? '' } as UnifiedPost], muteWords).length > 0;
  });
}

