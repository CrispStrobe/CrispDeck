import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayout, deleteLayout, duplicateLayout, exportLayouts, getActiveLayoutName,
  getLayout, importLayouts, listLayouts, MAX_WORKSPACE_FILE_BYTES, parseDeckColumns,
  renameLayout, saveLayout, setActiveLayoutName, WorkspaceError,
  type DeckColumnConfig, type DeckLayout, type WorkspaceExport,
} from './deck-layouts';
import type { Account } from './types';

const KEY = 'crispdeck-deck-layouts';
const ACTIVE = 'crispdeck-deck-active-layout';
const account = (id: number, patch: Partial<Account> = {}): Account => ({
  id, platform: 'bluesky', handle: 'alice.bsky.social', did: 'did:plc:alice',
  display_name: 'Alice', avatar_url: null, instance_url: null, mastodon_id: null,
  threads_user_id: null, is_primary: false, created_at: '', updated_at: '', ...patch,
});
const column = (patch: Partial<DeckColumnConfig> = {}): DeckColumnConfig => ({
  id: 'local-column', title: 'Home', type: 'timeline', ...patch,
});
const layout = (columns = [column()], name = 'Work'): DeckLayout => ({
  name, columns, createdAt: '2026-10-01T12:00:00.000Z',
});
const file = (): WorkspaceExport => exportLayouts([layout()]);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('workspace changes preserve saved state', () => {
  it('rejects empty names and collisions without overwriting another workspace', () => {
    createLayout('  Work  ', [column()]);
    createLayout('Personal', [column({ title: 'Personal timeline' })]);
    const before = localStorage.getItem(KEY);
    expect(() => createLayout('Work', [])).toThrow(WorkspaceError);
    expect(() => renameLayout('Work', 'Personal')).toThrow(/already exists/);
    expect(() => renameLayout('Work', '  ')).toThrow(WorkspaceError);
    expect(() => createLayout('x'.repeat(101), [])).toThrow(WorkspaceError);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it('preserves creation time when updating and renaming a workspace', () => {
    localStorage.setItem(KEY, JSON.stringify([layout()]));
    setActiveLayoutName('Work');
    saveLayout('Work', [column({ width: 500 })]);
    renameLayout('Work', 'Office');
    expect(getLayout('Office')?.createdAt).toBe('2026-10-01T12:00:00.000Z');
    expect(getLayout('Office')?.columns[0].width).toBe(500);
    expect(getActiveLayoutName()).toBe('Office');
  });

  it('duplicates with independent column IDs, account selections and filters', () => {
    createLayout('Work', [column({ accountIds: [1], filters: { notificationTypes: ['mention'], searchTerm: 'Crisp' } })]);
    const copy = duplicateLayout('Work')!;
    expect(copy.name).toBe('Work (copy)');
    expect(copy.columns[0].id).not.toBe('local-column');
    copy.columns[0].accountIds!.push(2);
    copy.columns[0].filters!.notificationTypes!.push('like');
    expect(getLayout('Work')?.columns[0].accountIds).toEqual([1]);
    expect(getLayout('Work')?.columns[0].filters?.notificationTypes).toEqual(['mention']);
    expect(getLayout('Work (copy)')?.columns[0].accountIds).toEqual([1]);
  });

  it('generates unique copy names at the maximum name length', () => {
    const name = 'W'.repeat(100);
    createLayout(name, [column()]);
    const first = duplicateLayout(name)!;
    const second = duplicateLayout(name)!;
    expect(first.name).toHaveLength(100);
    expect(second.name).toHaveLength(100);
    expect(second.name).not.toBe(first.name);
  });

  it.each(['null', '{}', '{bad json', '[{"name":"broken"}]'])(
    'tolerates corrupt storage for display but refuses destructive writes: %s', (raw) => {
      localStorage.setItem(KEY, raw);
      expect(listLayouts()).toEqual([]);
      expect(() => createLayout('New', [column()])).toThrow();
      expect(() => importLayouts(file())).toThrow();
      expect(localStorage.getItem(KEY)).toBe(raw);
    },
  );

  it('reports storage failures without reporting a successful save or import', () => {
    createLayout('Existing', [column()]);
    const before = localStorage.getItem(KEY);
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => saveLayout('New', [column()])).toThrow(/Could not save/);
    expect(() => importLayouts(file())).toThrow(/Could not save/);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it('rolls back a rename or delete when changing the active name fails', () => {
    createLayout('Work', [column()]);
    setActiveLayoutName('Work');
    const before = localStorage.getItem(KEY);
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation((key, value) => {
      if (key === ACTIVE) throw new Error('blocked');
      original(String(key), String(value));
    });
    expect(() => renameLayout('Work', 'Office')).toThrow(/Could not save/);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(JSON.parse(before!));
    expect(() => deleteLayout('Work')).toThrow(/Could not save/);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(JSON.parse(before!));
    expect(getActiveLayoutName()).toBe('Work');
  });

  it('rejects duplicate local column IDs before saving', () => {
    expect(() => saveLayout('Bad', [column(), column()])).toThrow(WorkspaceError);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('portable workspace files', () => {
  it('round-trips every supported column setting while remapping account IDs', () => {
    const original = column({
      type: 'search', title: 'Release watch', platform: 'bluesky', query: 'CrispDeck', width: 450,
      accountIds: [1], notify: 'both', scrollLock: false, color: '#34d399', pinned: true,
      collapsed: false, streaming: false, paused: true, refreshIntervalSeconds: 60,
      muteWords: ['spam', '/advert/i'],
      filters: { searchTerm: 'release', excludeText: 'bot', author: 'alice', language: 'de',
        hasMedia: true, hideReplies: true, hideReposts: false, minLikes: 3, minReposts: 2,
        notificationTypes: ['mention', 'reply'] },
    });
    const exported = exportLayouts([layout([original])], [account(1)]);
    expect(JSON.stringify(exported)).not.toContain('accountIds');
    const result = importLayouts(JSON.stringify(exported), [account(99, { handle: 'alice.new-domain.example' })]);
    const imported = result.layouts[0];
    expect(imported.createdAt).toBe('2026-10-01T12:00:00.000Z');
    expect(imported.columns[0]).toEqual({ ...original, id: expect.any(String), accountIds: [99] });
    expect(imported.columns[0].id).not.toBe(original.id);
    expect(result.missingAccounts).toBe(0);
  });

  it('exports an allowlist, never credentials or arbitrary fields', () => {
    const unsafe = layout([column()]);
    Object.assign(unsafe, { credential: 'layout-secret' });
    Object.assign(unsafe.columns[0], { accessToken: 'column-secret', accountIds: [1], filters: { hasMedia: true, token: 'filter-secret' } });
    const owner = account(1);
    Object.assign(owner, { accessToken: 'account-secret', refreshToken: 'refresh-secret' });
    const serialized = JSON.stringify(exportLayouts([unsafe], [owner]));
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('accountIds');
    expect(serialized).toContain('did:plc:alice');
    expect(serialized).toContain('hasMedia');
  });

  it('merges duplicate names without replacing existing workspaces or changing the active one', () => {
    createLayout('Work', [column({ title: 'Keep this' })]);
    setActiveLayoutName('Work');
    const source = file();
    source.layouts.push({ ...source.layouts[0], columns: [column({ title: 'Another import' })] });
    const result = importLayouts(source);
    expect(result.layouts.map(item => item.name)).toEqual(['Work (imported)', 'Work (imported 2)']);
    expect(getLayout('Work')?.columns[0].title).toBe('Keep this');
    expect(getActiveLayoutName()).toBe('Work');
    expect(listLayouts()).toHaveLength(3);
  });

  it('preserves all-account versus explicitly empty account selections', () => {
    const source = exportLayouts([layout([column({ id: 'all' }), column({ id: 'none', accountIds: [] })])]);
    const result = importLayouts(source, [account(1)]);
    expect(result.layouts[0].columns[0].accountIds).toBeUndefined();
    expect(result.layouts[0].columns[1].accountIds).toEqual([]);
  });

  it('does not reuse a numeric ID or a recycled handle for a different account', () => {
    const source = exportLayouts([layout([column({ accountIds: [1] })])], [account(1)]);
    const result = importLayouts(source, [account(1, { did: 'did:plc:someone-else' })]);
    expect(result.layouts[0].columns[0].accountIds).toEqual([]);
    expect(result.missingAccounts).toBe(1);
  });

  it('keeps unavailable selections disabled even if exported after disconnecting', () => {
    const source = exportLayouts([layout([column({ accountIds: [404] })])], []);
    const result = importLayouts(source, [account(404)]);
    expect(result.layouts[0].columns[0].accountIds).toEqual([]);
    expect(result.missingAccounts).toBe(1);
  });

  it('matches Mastodon IDs only on the exact instance', () => {
    const sourceAccount = account(1, { platform: 'mastodon', did: null, handle: 'alice@social.example', mastodon_id: '42', instance_url: 'https://social.example/' });
    const source = exportLayouts([layout([column({ accountIds: [1] })])], [sourceAccount]);
    const result = importLayouts(source, [
      { ...sourceAccount, id: 2, instance_url: 'https://other.example' },
      { ...sourceAccount, id: 3, instance_url: 'https://social.example' },
    ]);
    expect(result.layouts[0].columns[0].accountIds).toEqual([3]);
    expect(result.missingAccounts).toBe(0);
  });

  it('does not guess when more than one connected account has the same identity', () => {
    const source = exportLayouts([layout([column({ accountIds: [1] })])], [account(1)]);
    const result = importLayouts(source, [account(2), account(3)]);
    expect(result.layouts[0].columns[0].accountIds).toEqual([]);
    expect(result.missingAccounts).toBe(1);
  });

  it('validates every workspace before writing any of them', () => {
    createLayout('Existing', [column()]);
    const before = localStorage.getItem(KEY);
    const source: any = file();
    source.layouts.push({ name: 'Invalid', createdAt: '2026-10-01', columns: [{ ...column(), type: 'malicious' }] });
    expect(() => importLayouts(source)).toThrow(WorkspaceError);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it.each([
    { id: '' }, { title: null }, { type: 'unsupported' }, { width: 0 }, { width: 601 },
    { width: '400' }, { platform: 'unknown' }, { pinned: 'yes' }, { notify: 'loud' },
    { color: 'red; bad' }, { accountIds: [1] }, { refreshIntervalSeconds: 1 },
    { type: 'search', query: '' }, { filters: { minLikes: -1 } },
    { filters: { hideReplies: 'true' } }, { selectedAccounts: [{}] },
    { unavailableAccountCount: 2 }, { muteWords: [42] },
  ])('rejects invalid imported column configuration: %j', (patch) => {
    const source: any = file();
    Object.assign(source.layouts[0].columns[0], patch);
    expect(() => importLayouts(source)).toThrow(WorkspaceError);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('rejects duplicate IDs inside an imported workspace', () => {
    const source = file();
    source.layouts[0].columns.push({ ...source.layouts[0].columns[0] });
    expect(() => importLayouts(source)).toThrow(WorkspaceError);
  });

  it.each([{}, [], 'garbage', '{"format":"crispdeck-workspaces","version":99,"layouts":[]}'])(
    'rejects invalid or unsupported files: %j', (source) => {
      expect(() => importLayouts(source)).toThrow(WorkspaceError);
    },
  );

  it('enforces the byte limit, including multibyte text', () => {
    const source = JSON.stringify({ ...file(), extra: '界'.repeat(Math.ceil(MAX_WORKSPACE_FILE_BYTES / 3)) });
    expect(source.length).toBeLessThan(MAX_WORKSPACE_FILE_BYTES);
    expect(() => importLayouts(source)).toThrow(/smaller than 1 MB/);
  });

  it('refuses an export too large to import again', () => {
    const columns = Array.from({ length: 100 }, (_, index) => column({
      id: String(index), type: 'search', query: '界'.repeat(10000),
    }));
    expect(() => exportLayouts([layout(columns)])).toThrow(/smaller than 1 MB/);
  });

  it('does not persist unsupported fields from imported columns', () => {
    const source: any = file();
    source.layouts[0].columns[0].refreshToken = 'secret';
    const result = importLayouts(source);
    expect(result.layouts[0].columns[0]).not.toHaveProperty('refreshToken');
    expect(localStorage.getItem(KEY)).not.toContain('secret');
  });

  it('copies validated local columns without mutating the caller', () => {
    const source = [column({ accountIds: [1, 1], filters: { notificationTypes: ['like'] } })];
    const result = parseDeckColumns(source);
    result[0].filters!.notificationTypes!.push('reply');
    expect(source[0].filters!.notificationTypes).toEqual(['like']);
    expect(result[0].accountIds).toEqual([1]);
  });
});
