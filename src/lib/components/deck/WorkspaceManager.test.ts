import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import WorkspaceManager from './WorkspaceManager.svelte';
import { createLayout, exportLayouts, getActiveLayoutName, getLayout, listLayouts, setActiveLayoutName } from '$lib/deck-layouts';
import { i18n } from '$lib/i18n.svelte';
import type { Account } from '$lib/types';

vi.mock('$lib/toast.svelte', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

let instance: ReturnType<typeof mount> | undefined;
const columns = [{ id: 'home', title: 'Home', type: 'timeline' as const, width: 450 }];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Native dialog behavior is exercised in the browser suite. jsdom has no
  // implementation, but the real component still mounts and handles events.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value: function(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value: function(this: HTMLDialogElement) { this.open = false; },
  });
});

afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function render(accounts: Account[] = []) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onload = vi.fn();
  const onchange = vi.fn();
  const onclose = vi.fn();
  instance = mount(WorkspaceManager, { target, props: { columns, accounts, onload, onchange, onclose } });
  flushSync();
  return { target, onload, onchange, onclose };
}

function button(target: ParentNode, label: string): HTMLButtonElement {
  const element = [...target.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

function inputValue(input: HTMLInputElement, value: string) {
  flushSync(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(target: ParentNode, label: string) {
  flushSync(() => button(target, label).click());
}

async function importFile(target: ParentNode, contents: string) {
  const input = target.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: new TextEncoder().encode(contents).length, text: async () => contents }] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  await tick();
}

describe('workspace manager', () => {
  it('saves current columns under a new name and tracks the active workspace', () => {
    const { target, onchange } = render();
    inputValue(target.querySelector('#workspace-name')!, 'Work');
    click(target, i18n.t.deck.saveCurrentWorkspace);
    expect(getLayout('Work')?.columns).toEqual(columns);
    expect(getActiveLayoutName()).toBe('Work');
    expect(onchange).toHaveBeenCalledOnce();
    expect(target.querySelector('[role="status"]')?.textContent).toBe(i18n.t.deck.workspaceSaved);
  });

  it('refuses duplicate names through the actual save form', () => {
    createLayout('Work', [{ ...columns[0], title: 'Keep this' }]);
    const { target, onchange } = render();
    inputValue(target.querySelector('#workspace-name')!, 'Work');
    click(target, i18n.t.deck.saveCurrentWorkspace);
    expect(getLayout('Work')?.columns[0].title).toBe('Keep this');
    expect(onchange).not.toHaveBeenCalled();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(i18n.t.deck.workspaceDuplicateName);
  });

  it('renames from the inline editor and preserves the active selection', () => {
    createLayout('Work', columns);
    setActiveLayoutName('Work');
    const { target } = render();
    click(target, i18n.t.deck.renameLayout);
    inputValue(target.querySelector(`input[aria-label="${i18n.t.deck.newLayoutName}"]`)!, 'Office');
    click(target, i18n.t.deck.save);
    expect(getLayout('Work')).toBeUndefined();
    expect(getLayout('Office')?.columns).toEqual(columns);
    expect(getActiveLayoutName()).toBe('Office');
  });

  it('requires explicit delete confirmation and leaves current columns intact', () => {
    createLayout('Work', columns);
    setActiveLayoutName('Work');
    const { target } = render();
    click(target, i18n.t.deck.deleteLayout);
    expect(getLayout('Work')).toBeDefined();
    click(target, i18n.t.common.cancel);
    expect(getLayout('Work')).toBeDefined();
    click(target, i18n.t.deck.deleteLayout);
    click(target, i18n.t.deck.confirmDeleteWorkspace);
    expect(getLayout('Work')).toBeUndefined();
    expect(getActiveLayoutName()).toBeNull();
    expect(columns).toEqual([{ id: 'home', title: 'Home', type: 'timeline', width: 450 }]);
  });

  it('duplicates a workspace and delegates switching to the parent', async () => {
    createLayout('Work', columns);
    const { target, onload, onclose } = render();
    click(target, i18n.t.deck.duplicateLayout);
    const copy = target.querySelector('section[aria-label="Work (copy)"]')!;
    expect(copy).not.toBeNull();
    click(copy, i18n.t.deck.switchLayout);
    await tick();
    expect(onload).toHaveBeenCalledWith('Work (copy)');
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('imports from a file and explains unmatched account identities', async () => {
    const account = { id: 1, platform: 'bluesky', handle: 'writer.example', did: 'did:plc:writer' } as Account;
    const data = exportLayouts([{ name: 'Imported', createdAt: '2026-10-01', columns: [{ ...columns[0], accountIds: [1] }] }], [account]);
    const { target, onchange } = render([]);
    await importFile(target, JSON.stringify(data));
    expect(getLayout('Imported')?.columns[0].accountIds).toEqual([]);
    expect(target.textContent).toContain(i18n.t.deck.workspaceMissingAccounts.replace('{count}', '1'));
    expect(onchange).toHaveBeenCalledOnce();
  });

  it('leaves stored workspaces intact after a malformed import', async () => {
    createLayout('Work', columns);
    const { target } = render();
    await importFile(target, '{invalid');
    expect(listLayouts().map(layout => layout.name)).toEqual(['Work']);
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(i18n.t.deck.workspaceInvalidFile);
  });

  it('does not persist an import that finishes after the dialog was closed', async () => {
    const data = JSON.stringify(exportLayouts([{ name: 'Late', createdAt: '2026-10-01', columns }]));
    const { target } = render();
    let finish!: (value: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ size: data.length, text: () => pending }] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await unmount(instance!);
    instance = undefined;
    finish(data);
    await tick();
    expect(listLayouts()).toEqual([]);
  });

  it('exports a JSON download from the requested saved workspace', () => {
    createLayout('Work', columns);
    const startDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const { target } = render();
    click(target, i18n.t.deck.exportWorkspace);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(startDownload).toHaveBeenCalledOnce();
  });

  it('reports a failed persistence operation and does not announce success', () => {
    const { target, onchange } = render();
    vi.spyOn(Object.getPrototypeOf(localStorage), 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    inputValue(target.querySelector('#workspace-name')!, 'Work');
    click(target, i18n.t.deck.saveCurrentWorkspace);
    expect(onchange).not.toHaveBeenCalled();
    expect(target.querySelector('[role="status"]')).toBeNull();
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(i18n.t.deck.workspaceSaveFailed);
  });

  it('focuses the name field and restores focus to its launcher on close', async () => {
    const launcher = document.createElement('button');
    document.body.appendChild(launcher);
    launcher.focus();
    const { target } = render();
    expect(document.activeElement).toBe(target.querySelector('#workspace-name'));
    await unmount(instance!);
    instance = undefined;
    expect(document.activeElement).toBe(launcher);
  });
});
