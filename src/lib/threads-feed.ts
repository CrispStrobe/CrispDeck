import { readJson, writeJson } from './safe-storage';
import type { ThreadsClient, ThreadsPost } from './api/threads';

export interface ThreadsSources { profiles: string[]; keywords: string[] }
const key = (account: string) => `crispdeck-threads-feed:${account.toLowerCase()}`;
const empty = (): ThreadsSources => ({ profiles: [], keywords: [] });
export function getThreadsSources(account: string): ThreadsSources {
  const value = readJson<ThreadsSources>(key(account), empty());
  return { profiles: Array.isArray(value?.profiles) ? value.profiles.filter(x => typeof x === 'string') : [], keywords: Array.isArray(value?.keywords) ? value.keywords.filter(x => typeof x === 'string') : [] };
}
export function parseProfiles(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(s => s.trim().replace(/^@/, '').toLowerCase()).filter(s => /^[a-z0-9._]{1,30}$/.test(s)))];
}
export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
}
export function saveThreadsSources(account: string, sources: ThreadsSources): boolean {
  return writeJson(key(account), sources);
}
/** Extract Meta following exports without treating unrelated JSON values as usernames. */
export function importThreadsProfiles(text: string): string[] {
  if (text.length > 2_000_000) throw new Error('File is too large (maximum 2 MB).');
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('Choose a JSON following export.'); }
  const names: string[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.string_list_data)) for (const item of record.string_list_data) {
      if (item && typeof item === 'object' && typeof item.value === 'string') names.push(item.value);
    }
    for (const [k, v] of Object.entries(record)) if (k !== 'string_list_data') visit(v);
  }
  visit(json);
  const result = parseProfiles(names.join('\n'));
  if (!result.length) throw new Error('No usernames found in this following export.');
  return result;
}

type Cached = { at: number; posts: ThreadsPost[] };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<ThreadsPost[]>>();
const failures = new Map<string, number>();
const TTL = 2 * 60 * 60 * 1000;
async function cached(account: string, kind: string, name: string, load: () => Promise<ThreadsPost[]>): Promise<ThreadsPost[]> {
  const k = `${account.toLowerCase()}\0${kind}\0${name.toLowerCase()}`;
  const saved = cache.get(k) ?? readJson<Cached | null>(`crispdeck-threads-cache:${encodeURIComponent(k)}`, null); 
  if (saved && Date.now() - saved.at < TTL) return saved.posts;
  if ((failures.get(k) ?? 0) > Date.now()) throw new Error('Source temporarily unavailable');
  const existing = pending.get(k);
  if (existing) return existing;
  const request = load().then(posts => { const value = { at: Date.now(), posts }; cache.set(k, value); writeJson(`crispdeck-threads-cache:${encodeURIComponent(k)}`, value); failures.delete(k); return posts; }).catch(error => { failures.set(k, Date.now() + TTL); throw error; }).finally(() => pending.delete(k));
  pending.set(k, request);
  return request;
}
export async function buildThreadsFeed(client: ThreadsClient, account: string, sources: ThreadsSources, limit: number): Promise<{ posts: ThreadsPost[]; failures: string[] }> {
  const own = await client.getOwnPosts(limit);
  const jobs = [
    { label: 'mentions', run: () => client.getAllMentions() },
    ...sources.profiles.slice(0, 50).map(name => ({ label: `@${name}`, run: () => client.getUserPosts(name, limit) })),
    ...sources.keywords.slice(0, 10).map(name => ({ label: `“${name}”`, run: () => client.keywordSearch(name, { searchType: 'RECENT', limit }) })),
  ];
  const results: Array<{ posts?: ThreadsPost[]; error?: string }> = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      try { results[index] = { posts: await cached(account, 'source', job.label, job.run) }; }
      catch { results[index] = { error: job.label }; }
    }
  }));
  const seen = new Set<string>();
  const posts = [...own, ...results.flatMap(r => r.posts ?? [])].filter(post => {
    if (!post.id || seen.has(post.id)) return false;
    seen.add(post.id); return true;
  });
  return { posts, failures: results.flatMap(r => r.error ? [r.error] : []) };
}
