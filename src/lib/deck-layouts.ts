/** Saved workspaces and portable, credential-free workspace files. */

import { isColumnType, requiresQuery, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH, type ColumnType } from './deck-columns';
import type { DeckColumnFilters } from './deck-filters';
import type { Account, Platform } from './types';
import { readString, writeJson, writeString } from './safe-storage';
import { swallow } from './debug-log';

export type ColumnNotifyMode = 'off' | 'sound' | 'desktop' | 'both';

export interface DeckColumnConfig {
  id: string;
  title: string;
  type: ColumnType;
  platform?: string;
  query?: string;
  width?: number;
  streaming?: boolean;
  notify?: ColumnNotifyMode;
  scrollLock?: boolean;
  color?: string;
  collapsed?: boolean;
  pinned?: boolean;
  muteWords?: string[];
  /** Undefined means all eligible accounts; an empty selection means none. */
  accountIds?: number[];
  filters?: DeckColumnFilters;
  paused?: boolean;
  refreshIntervalSeconds?: number;
}

export const COLUMN_WIDTH_PRESETS = { narrow: 280, medium: 350, wide: 450 } as const;
export type ColumnWidthPreset = keyof typeof COLUMN_WIDTH_PRESETS;

export interface DeckLayout {
  name: string;
  columns: DeckColumnConfig[];
  createdAt: string;
}

/** Identity only. Local database IDs and authentication data are not portable. */
export interface WorkspaceAccountReference {
  platform: Platform;
  handle: string;
  subject?: string;
  instance?: string;
}

export interface PortableDeckColumn extends Omit<DeckColumnConfig, 'accountIds'> {
  selectedAccounts?: WorkspaceAccountReference[];
  /** Preserve a disconnected selection instead of widening it to every account. */
  unavailableAccountCount?: number;
}

export interface WorkspaceExport {
  format: 'crispdeck-workspaces';
  version: 1;
  exportedAt: string;
  layouts: Array<Omit<DeckLayout, 'columns'> & { columns: PortableDeckColumn[] }>;
}

export interface WorkspaceImportResult {
  layouts: DeckLayout[];
  missingAccounts: number;
}

export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;
export const MAX_WORKSPACE_NAME_LENGTH = 100;
const MAX_LAYOUTS = 100;
const MAX_COLUMNS = 100;
const LAYOUTS_KEY = 'crispdeck-deck-layouts';
const ACTIVE_KEY = 'crispdeck-deck-active-layout';
const PLATFORMS: readonly string[] = ['bluesky', 'mastodon', 'threads'];
const REFRESH_INTERVALS = [30, 60, 120, 300, 600];

export type WorkspaceErrorCode = 'invalid-name' | 'duplicate-name' | 'invalid-file' | 'file-too-large' | 'storage' | 'no-layouts';
export class WorkspaceError extends Error {
  constructor(public code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

function invalidFile(): never {
  throw new WorkspaceError('invalid-file', 'This is not a valid CrispDeck workspace file.');
}

function checkFileSize(contents: string): void {
  if (contents.length > MAX_WORKSPACE_FILE_BYTES || new TextEncoder().encode(contents).length > MAX_WORKSPACE_FILE_BYTES) {
    throw new WorkspaceError('file-too-large', 'Choose a workspace file smaller than 1 MB.');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalidFile();
  return value;
}

function layoutName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new WorkspaceError('invalid-name', 'Enter a workspace name of 1 to 100 characters.');
  }
  return value.trim();
}

function stringList(value: unknown, maxItems = 100, maxLength = 1000): string[] {
  if (!Array.isArray(value) || value.length > maxItems) invalidFile();
  return value.map(item => text(item, maxLength));
}

function parseFilters(value: unknown): DeckColumnFilters {
  if (!record(value)) invalidFile();
  const filters: DeckColumnFilters = {};
  for (const key of ['searchTerm', 'excludeText', 'author', 'language'] as const) {
    if (value[key] !== undefined) filters[key] = text(value[key], 4000, true);
  }
  for (const key of ['hasMedia', 'hideReplies', 'hideReposts'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') invalidFile();
      filters[key] = value[key];
    }
  }
  for (const key of ['minLikes', 'minReposts'] as const) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) invalidFile();
      filters[key] = value[key] as number;
    }
  }
  if (value.notificationTypes !== undefined) filters.notificationTypes = [...new Set(stringList(value.notificationTypes, 50, 100))];
  return filters;
}

/** Validate and copy known fields; imported extras can never enter app state. */
function parseColumn(value: unknown, requireQuery = false): DeckColumnConfig {
  if (!record(value) || typeof value.type !== 'string' || !isColumnType(value.type)) invalidFile();
  const column: DeckColumnConfig = {
    id: text(value.id, 200),
    title: text(value.title, 300),
    type: value.type,
  };
  if (value.platform !== undefined) {
    if (typeof value.platform !== 'string' || !['', 'all', ...PLATFORMS].includes(value.platform)) invalidFile();
    if (value.platform) column.platform = value.platform;
  }
  if (value.query !== undefined) column.query = text(value.query, 10000, true);
  if (requireQuery && requiresQuery(column.type) && !column.query?.trim()) invalidFile();
  if (value.width !== undefined) {
    if (typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width < MIN_COLUMN_WIDTH || value.width > MAX_COLUMN_WIDTH) invalidFile();
    column.width = value.width;
  }
  for (const key of ['streaming', 'scrollLock', 'collapsed', 'pinned', 'paused'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') invalidFile();
      column[key] = value[key];
    }
  }
  if (value.notify !== undefined) {
    if (!['off', 'sound', 'desktop', 'both'].includes(value.notify as string)) invalidFile();
    column.notify = value.notify as ColumnNotifyMode;
  }
  if (value.color !== undefined) {
    const color = text(value.color, 9, true);
    if (color && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) invalidFile();
    column.color = color;
  }
  if (value.muteWords !== undefined) column.muteWords = stringList(value.muteWords);
  if (value.accountIds !== undefined) {
    if (!Array.isArray(value.accountIds) || value.accountIds.length > 100 || value.accountIds.some(id => !Number.isSafeInteger(id) || id < 1)) invalidFile();
    column.accountIds = [...new Set(value.accountIds as number[])];
  }
  if (value.filters !== undefined) column.filters = parseFilters(value.filters);
  if (value.refreshIntervalSeconds !== undefined) {
    if (!REFRESH_INTERVALS.includes(value.refreshIntervalSeconds as number)) invalidFile();
    column.refreshIntervalSeconds = value.refreshIntervalSeconds as number;
  }
  return column;
}

export function parseDeckColumns(value: unknown): DeckColumnConfig[] {
  if (!Array.isArray(value) || value.length > MAX_COLUMNS) invalidFile();
  const columns = value.map(column => parseColumn(column));
  if (new Set(columns.map(column => column.id)).size !== columns.length) invalidFile();
  return columns;
}

function parseLayout(value: unknown): DeckLayout {
  if (!record(value)) invalidFile();
  const name = layoutName(value.name);
  const createdAt = text(value.createdAt, 100);
  if (!Number.isFinite(Date.parse(createdAt))) invalidFile();
  return { name, createdAt, columns: parseDeckColumns(value.columns) };
}

/** Mutations fail closed if existing storage is unreadable, rather than erase it. */
function storedLayouts(): DeckLayout[] {
  const raw = localStorage.getItem(LAYOUTS_KEY);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > MAX_LAYOUTS) invalidFile();
  const layouts = value.map(parseLayout);
  if (new Set(layouts.map(layout => layout.name)).size !== layouts.length) invalidFile();
  return layouts;
}

function persistLayouts(layouts: DeckLayout[]): void {
  if (layouts.length > MAX_LAYOUTS) invalidFile();
  if (!writeJson(LAYOUTS_KEY, layouts)) {
    throw new WorkspaceError('storage', 'Could not save workspaces on this device.');
  }
}

export function listLayouts(): DeckLayout[] {
  try {
    return storedLayouts();
  } catch (error) {
    swallow('deck-layouts.read', error);
    return [];
  }
}

export function getLayout(name: string): DeckLayout | undefined {
  return listLayouts().find(layout => layout.name === name);
}

export function saveLayout(name: string, columns: DeckColumnConfig[]): DeckLayout {
  name = layoutName(name);
  const parsedColumns = parseDeckColumns(columns);
  const layouts = storedLayouts();
  const existing = layouts.findIndex(layout => layout.name === name);
  const layout: DeckLayout = {
    name,
    columns: parsedColumns,
    createdAt: existing >= 0 ? layouts[existing].createdAt : new Date().toISOString(),
  };
  if (existing >= 0) layouts[existing] = layout;
  else layouts.push(layout);
  persistLayouts(layouts);
  return layout;
}

/** Explicit creation prevents an accidental name collision from overwriting a deck. */
export function createLayout(name: string, columns: DeckColumnConfig[]): DeckLayout {
  name = layoutName(name);
  if (storedLayouts().some(layout => layout.name === name)) {
    throw new WorkspaceError('duplicate-name', 'A workspace with that name already exists.');
  }
  return saveLayout(name, columns);
}

function changeLayoutsAndActive(before: DeckLayout[], after: DeckLayout[], active: string | null): void {
  persistLayouts(after);
  try {
    setActiveLayoutName(active);
  } catch (error) {
    // Storage can fail selectively (for example, after reaching its quota).
    // Revert the first write so a failed rename/delete is not reported as done.
    if (!writeJson(LAYOUTS_KEY, before)) swallow('deck-layouts.rollback', error);
    throw error;
  }
}

export function deleteLayout(name: string): void {
  const layouts = storedLayouts();
  if (!layouts.some(layout => layout.name === name)) return;
  const remaining = layouts.filter(layout => layout.name !== name);
  if (getActiveLayoutName() === name) changeLayoutsAndActive(layouts, remaining, null);
  else persistLayouts(remaining);
}

export function renameLayout(oldName: string, newName: string): void {
  newName = layoutName(newName);
  const layouts = storedLayouts();
  if (oldName === newName || !layouts.some(layout => layout.name === oldName)) return;
  if (layouts.some(layout => layout.name === newName)) {
    throw new WorkspaceError('duplicate-name', 'A workspace with that name already exists.');
  }
  const renamed = layouts.map(layout => layout.name === oldName ? { ...layout, name: newName } : layout);
  if (getActiveLayoutName() === oldName) changeLayoutsAndActive(layouts, renamed, newName);
  else persistLayouts(renamed);
}

export function getActiveLayoutName(): string | null {
  return readString(ACTIVE_KEY) || null;
}

export function setActiveLayoutName(name: string | null): void {
  if (!writeString(ACTIVE_KEY, name === null ? '' : layoutName(name))) {
    throw new WorkspaceError('storage', 'Could not save workspaces on this device.');
  }
}

function uniqueName(name: string, existing: Set<string>, suffix: 'copy' | 'imported'): string {
  if (suffix === 'imported' && !existing.has(name)) return name;
  let index = 1;
  let candidate: string;
  do {
    const tail = ` (${suffix}${index > 1 ? ` ${index}` : ''})`;
    candidate = `${name.slice(0, MAX_WORKSPACE_NAME_LENGTH - tail.length)}${tail}`;
    index++;
  } while (existing.has(candidate));
  return candidate;
}

export function duplicateLayout(name: string): DeckLayout | null {
  const layouts = storedLayouts();
  const source = layouts.find(layout => layout.name === name);
  if (!source) return null;
  const copyName = uniqueName(name, new Set(layouts.map(layout => layout.name)), 'copy');
  return createLayout(copyName, source.columns.map(column => ({ ...column, id: crypto.randomUUID() })));
}

function instanceOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalidFile();
    return url.origin.toLowerCase();
  } catch {
    return invalidFile();
  }
}

function accountReference(account: Account): WorkspaceAccountReference {
  const reference: WorkspaceAccountReference = { platform: account.platform, handle: account.handle };
  const subject = account.platform === 'bluesky' ? account.did : account.platform === 'mastodon' ? account.mastodon_id : account.threads_user_id;
  if (subject) reference.subject = subject;
  if (account.platform === 'mastodon' && account.instance_url) reference.instance = instanceOrigin(account.instance_url);
  return reference;
}

function parseAccountReference(value: unknown): WorkspaceAccountReference {
  if (!record(value) || !PLATFORMS.includes(value.platform as string)) invalidFile();
  const reference: WorkspaceAccountReference = { platform: value.platform as Platform, handle: text(value.handle, 512) };
  if (value.subject !== undefined) reference.subject = text(value.subject, 512);
  if (value.instance !== undefined) reference.instance = instanceOrigin(text(value.instance, 2048));
  // A Mastodon ID only makes sense on its own server; never match it globally.
  if (reference.platform === 'mastodon' && !reference.instance) invalidFile();
  return reference;
}

function accountMatches(reference: WorkspaceAccountReference, account: Account): boolean {
  if (account.platform !== reference.platform) return false;
  const candidate = accountReference(account);
  if (reference.platform === 'mastodon' && candidate.instance !== reference.instance) return false;
  if (reference.subject) return candidate.subject === reference.subject;
  return candidate.handle.replace(/^@/, '').toLowerCase() === reference.handle.replace(/^@/, '').toLowerCase();
}

/** Export only known display/source settings and public account identities. */
export function exportLayouts(layouts: DeckLayout[], accounts: Account[] = []): WorkspaceExport {
  if (!layouts.length) throw new WorkspaceError('no-layouts', 'Save a workspace before exporting.');
  if (layouts.length > MAX_LAYOUTS) invalidFile();
  const data: WorkspaceExport = {
    format: 'crispdeck-workspaces',
    version: 1,
    exportedAt: new Date().toISOString(),
    layouts: layouts.map(value => {
      const layout = parseLayout(value);
      return {
        name: layout.name,
        createdAt: layout.createdAt,
        columns: layout.columns.map(({ accountIds, ...column }) => {
          const portable: PortableDeckColumn = { ...column };
          if (accountIds !== undefined) {
            portable.selectedAccounts = [];
            let unavailable = 0;
            for (const id of accountIds) {
              const account = accounts.find(candidate => candidate.id === id);
              if (account) portable.selectedAccounts.push(accountReference(account));
              else unavailable++;
            }
            if (unavailable) portable.unavailableAccountCount = unavailable;
          }
          return portable;
        }),
      };
    }),
  };
  // The UI downloads a formatted file. Refuse an export that this importer
  // would reject, so a successful backup remains usable on another device.
  checkFileSize(JSON.stringify(data, null, 2));
  return data;
}

/** Validate the whole file before its single write; never overwrite existing names. */
export function importLayouts(input: unknown, accounts: Account[] = []): WorkspaceImportResult {
  let value: unknown = input;
  if (typeof input === 'string') {
    checkFileSize(input);
    try { value = JSON.parse(input); } catch { invalidFile(); }
  } else {
    let serialized: string | undefined;
    try { serialized = JSON.stringify(input); } catch { invalidFile(); }
    if (!serialized) invalidFile();
    checkFileSize(serialized);
  }
  if (!record(value) || value.format !== 'crispdeck-workspaces' || value.version !== 1 || !Array.isArray(value.layouts) || !value.layouts.length || value.layouts.length > MAX_LAYOUTS) invalidFile();
  let missingAccounts = 0;
  const imported: DeckLayout[] = value.layouts.map(raw => {
    if (!record(raw) || !Array.isArray(raw.columns) || raw.columns.length > MAX_COLUMNS) invalidFile();
    const columns = raw.columns.map(rawColumn => {
      if (!record(rawColumn) || rawColumn.accountIds !== undefined) invalidFile();
      const column = parseColumn(rawColumn, true);
      if (rawColumn.selectedAccounts !== undefined) {
        if (!Array.isArray(rawColumn.selectedAccounts) || rawColumn.selectedAccounts.length > 100) invalidFile();
        column.accountIds = [];
        for (const rawReference of rawColumn.selectedAccounts) {
          const reference = parseAccountReference(rawReference);
          const matches = accounts.filter(account => accountMatches(reference, account));
          if (matches.length === 1) column.accountIds.push(matches[0].id);
          else missingAccounts++;
        }
        column.accountIds = [...new Set(column.accountIds)];
      }
      if (rawColumn.unavailableAccountCount !== undefined) {
        if (!Number.isSafeInteger(rawColumn.unavailableAccountCount) || (rawColumn.unavailableAccountCount as number) < 0 || (rawColumn.unavailableAccountCount as number) > 100 || rawColumn.selectedAccounts === undefined) invalidFile();
        missingAccounts += rawColumn.unavailableAccountCount as number;
      }
      return column;
    });
    const layout = parseLayout({ name: raw.name, createdAt: raw.createdAt, columns });
    // IDs identify local loading/subscription state, not portable sources.
    layout.columns = layout.columns.map(column => ({ ...column, id: crypto.randomUUID() }));
    return layout;
  });
  const existing = storedLayouts();
  const names = new Set(existing.map(layout => layout.name));
  for (const layout of imported) {
    layout.name = uniqueName(layout.name, names, 'imported');
    names.add(layout.name);
  }
  persistLayouts([...existing, ...imported]);
  return { layouts: imported, missingAccounts };
}
