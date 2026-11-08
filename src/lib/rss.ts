/**
 * RSS/Atom feed parser and subscription manager.
 * Subscriptions stored in localStorage.
 * Fetches and parses feeds via a CORS proxy or direct fetch.
 */

import type { UnifiedPost } from './types';
import { writeJson } from './safe-storage';
import { cacheSearchItems, getSearchCacheGeneration, getSearchCacheSettings, removeSearchCacheScope } from './search-cache';
import { swallow } from './debug-log';

export interface RssFeed {
  id: string;
  url: string;
  title: string;
  lastFetched?: string;
}

export interface RssItem {
  title: string;
  link: string;
  description: string;
  /** Original article markup, consumed transiently by the optional text index. */
  content?: string;
  pubDate: string;
  author?: string;
}

const STORAGE_KEY = 'crispdeck-rss-feeds';

// ── Subscription management ──────────────────────────────────────────────

export function listFeeds(): RssFeed[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addFeed(url: string, title?: string): RssFeed {
  const feeds = listFeeds();
  const feed: RssFeed = {
    id: `rss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    url: url.trim(),
    title: title?.trim() || url,
  };
  feeds.push(feed);
  writeJson(STORAGE_KEY, feeds);
  return feed;
}

export function removeFeed(id: string): void {
  const feeds = listFeeds().filter(f => f.id !== id);
  writeJson(STORAGE_KEY, feeds);
  void removeSearchCacheScope(`rss:${id}`).catch(error => swallow('search-cache.rss.remove', error));
}

export function importOPML(opmlText: string): RssFeed[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlText, 'text/xml');
  const outlines = doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]');
  const feeds = listFeeds();
  const imported: RssFeed[] = [];

  for (const outline of outlines) {
    const url = outline.getAttribute('xmlUrl') || outline.getAttribute('xmlurl');
    const title = outline.getAttribute('title') || outline.getAttribute('text') || url;
    if (url) {
      const feed: RssFeed = {
        id: `rss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: url.trim(),
        title: title?.trim() || url,
      };
      feeds.push(feed);
      imported.push(feed);
    }
  }

  writeJson(STORAGE_KEY, feeds);
  return imported;
}

// ── Feed fetching & parsing ──────────────────────────────────────────────

/** Parse RSS 2.0 or Atom XML into items */
function parseRssXml(xml: string): RssItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const items: RssItem[] = [];

  // RSS 2.0
  const rssItems = doc.querySelectorAll('item');
  if (rssItems.length > 0) {
    for (const item of rssItems) {
      items.push({
        title: item.querySelector('title')?.textContent ?? '',
        link: item.querySelector('link')?.textContent ?? '',
        content: item.getElementsByTagName('content:encoded')[0]?.textContent ?? item.querySelector('description')?.textContent ?? '',
        description: (item.querySelector('description')?.textContent ?? '').replace(/<[^>]*>/g, '').substring(0, 500),
        pubDate: item.querySelector('pubDate')?.textContent ?? '',
        author: item.querySelector('author')?.textContent || item.querySelector('dc\\:creator')?.textContent || undefined,
      });
    }
    return items;
  }

  // Atom
  const atomEntries = doc.querySelectorAll('entry');
  for (const entry of atomEntries) {
    const link = entry.querySelector('link[rel="alternate"]')?.getAttribute('href')
      ?? entry.querySelector('link')?.getAttribute('href') ?? '';
    items.push({
      title: entry.querySelector('title')?.textContent ?? '',
      link,
      content: entry.querySelector('content')?.textContent ?? entry.querySelector('summary')?.textContent ?? '',
      description: (entry.querySelector('summary')?.textContent ?? entry.querySelector('content')?.textContent ?? '').replace(/<[^>]*>/g, '').substring(0, 500),
      pubDate: entry.querySelector('published')?.textContent ?? entry.querySelector('updated')?.textContent ?? '',
      author: entry.querySelector('author > name')?.textContent || undefined,
    });
  }

  return items;
}

/** Fetch and parse an RSS/Atom feed URL */
export async function fetchFeed(url: string): Promise<RssItem[]> {
  const searchGeneration = getSearchCacheGeneration();
  const feeds = listFeeds();
  const subscription = Array.isArray(feeds) ? feeds.find(feed => feed.url === url) : undefined;
  // Try direct fetch first (works for CORS-enabled feeds)
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch feed: ${resp.status}`);
  const xml = await resp.text();
  const items = parseRssXml(xml);
  const settings = getSearchCacheSettings();
  if (settings.enabled && settings.posts.enabled) {
    void cacheSearchItems(items.map(item => ({
      source: 'rss' as const, scope: `rss:${subscription?.id ?? url}`, id: item.link, url: item.link,
      title: item.title, text: item.content ?? item.description, html: true,
      author: item.author || subscription?.title || '', createdAt: item.pubDate,
    })), { generation: searchGeneration }).catch(error => swallow('search-cache.rss.ingest', error));
  }
  return items;
}

/** Convert an RSS item to a UnifiedPost for display in feed/deck */
export function rssItemToPost(item: RssItem, feedTitle: string): UnifiedPost {
  return {
    uri: item.link || `rss:${Date.now()}:${Math.random()}`,
    text: item.title + (item.description ? `\n\n${item.description}` : ''),
    author: {
      handle: feedTitle,
      displayName: item.author || feedTitle,
    },
    createdAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    platform: 'mastodon', // Use mastodon styling for RSS items (no special platform needed)
    isRepost: false,
  };
}
