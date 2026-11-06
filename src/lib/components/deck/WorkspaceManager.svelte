<script lang="ts">
  import { onMount } from 'svelte';
  import { Copy, Download, Pencil, Save, Trash2, Upload, X } from '@lucide/svelte';
  import { i18n } from '$lib/i18n.svelte';
  import { swallow } from '$lib/debug-log';
  import { toast } from '$lib/toast.svelte';
  import { STARTER_WORKSPACES, type WorkspaceId } from '$lib/starter-workspaces';
  import {
    createLayout, deleteLayout, duplicateLayout, exportLayouts, getActiveLayoutName,
    importLayouts, listLayouts, MAX_WORKSPACE_FILE_BYTES, MAX_WORKSPACE_NAME_LENGTH,
    renameLayout, saveLayout, setActiveLayoutName, WorkspaceError,
    type DeckColumnConfig, type DeckLayout,
  } from '$lib/deck-layouts';
  import type { Account } from '$lib/types';

  let { columns, accounts = [], onload, onchange, onclose }: {
    columns: DeckColumnConfig[];
    accounts?: Account[];
    onload: (name: string) => void | Promise<void>;
    onchange?: () => void;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let nameInput: HTMLInputElement;
  let fileInput: HTMLInputElement;
  let layouts = $state<DeckLayout[]>(listLayouts());
  let active = $state(getActiveLayoutName());
  let name = $state('');
  let renaming = $state<string | null>(null);
  let renamed = $state('');
  let deleting = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  let warning = $state('');
  let destroyed = false;

  onMount(() => {
    const previousFocus = document.activeElement;
    dialog.showModal();
    nameInput.focus();
    return () => {
      destroyed = true;
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  });

  function displayName(value: string): string {
    const key = value.replace(/^starter:/, '') as WorkspaceId;
    return value.startsWith('starter:') && STARTER_WORKSPACES.includes(key) ? i18n.t.workflow[key] : value;
  }

  function refresh() {
    layouts = listLayouts();
    active = getActiveLayoutName();
    onchange?.();
  }

  function resetFeedback() {
    error = '';
    message = '';
    warning = '';
  }

  function report(cause: unknown) {
    swallow('WorkspaceManager.action', cause);
    const labels = {
      'invalid-name': i18n.t.deck.workspaceEmptyName,
      'duplicate-name': i18n.t.deck.workspaceDuplicateName,
      'invalid-file': i18n.t.deck.workspaceInvalidFile,
      'file-too-large': i18n.t.deck.workspaceFileTooLarge,
      storage: i18n.t.deck.workspaceSaveFailed,
      'no-layouts': i18n.t.deck.workspaceNoSavedExport,
    };
    error = cause instanceof WorkspaceError ? labels[cause.code] : i18n.t.deck.workspaceSaveFailed;
    toast.error(error);
  }

  function saveCurrent() {
    resetFeedback();
    try {
      const saved = createLayout(name, columns);
      setActiveLayoutName(saved.name);
      name = '';
      refresh();
      message = i18n.t.deck.workspaceSaved;
    } catch (cause) { report(cause); }
  }

  function updateCurrent() {
    if (!active) return;
    resetFeedback();
    try {
      saveLayout(active, columns);
      refresh();
      message = i18n.t.deck.workspaceSaved;
    } catch (cause) { report(cause); }
  }

  async function switchTo(value: string) {
    resetFeedback();
    busy = true;
    try {
      await onload(value);
      onclose();
    } catch (cause) { report(cause); }
    finally { busy = false; }
  }

  function rename(value: string) {
    resetFeedback();
    try {
      renameLayout(value, renamed);
      renaming = null;
      refresh();
      message = i18n.t.deck.workspaceRenamed;
    } catch (cause) { report(cause); }
  }

  function duplicate(value: string) {
    resetFeedback();
    try {
      duplicateLayout(value);
      refresh();
      message = i18n.t.deck.workspaceSaved;
    } catch (cause) { report(cause); }
  }

  function remove(value: string) {
    resetFeedback();
    try {
      deleteLayout(value);
      deleting = null;
      refresh();
      message = i18n.t.deck.workspaceDeleted;
    } catch (cause) { report(cause); }
  }

  function download(selected: DeckLayout[]) {
    resetFeedback();
    try {
      const data = exportLayouts(selected, accounts);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `crispdeck-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      try { link.click(); }
      finally {
        link.remove();
        // Keep the object URL alive until the browser has started the download.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) { report(cause); }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    resetFeedback();
    busy = true;
    try {
      if (file.size > MAX_WORKSPACE_FILE_BYTES) throw new WorkspaceError('file-too-large', 'Workspace file is too large.');
      const contents = await file.text();
      if (destroyed) return;
      const result = importLayouts(contents, accounts);
      refresh();
      message = i18n.t.deck.workspaceImported.replace('{count}', String(result.layouts.length));
      if (result.missingAccounts) {
        warning = i18n.t.deck.workspaceMissingAccounts.replace('{count}', String(result.missingAccounts));
        toast.warning(warning);
      }
    } catch (cause) { if (!destroyed) report(cause); }
    finally { if (!destroyed) busy = false; }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="workspace-manager-title"
  oncancel={(event) => { event.preventDefault(); onclose(); }}
  class="workspace-dialog rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] shadow-2xl"
>
  <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]">
    <h2 id="workspace-manager-title" class="text-lg font-semibold">{i18n.t.deck.manageWorkspaces}</h2>
    <button type="button" class="p-2 rounded-lg hover:bg-[var(--color-surface)]" aria-label={i18n.t.common.close} onclick={onclose}><X size={18} /></button>
  </div>

  <div class="workspace-content p-5 space-y-5">
    <form onsubmit={(event) => { event.preventDefault(); saveCurrent(); }} class="space-y-2">
      <label for="workspace-name" class="block text-sm font-medium">{i18n.t.deck.workspaceName}</label>
      <div class="flex flex-wrap gap-2">
        <input id="workspace-name" bind:this={nameInput} bind:value={name} maxlength={MAX_WORKSPACE_NAME_LENGTH} required disabled={busy} class="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !name.trim()} class="action primary"><Save size={14} />{i18n.t.deck.saveCurrentWorkspace}</button>
      </div>
      {#if active && layouts.some(layout => layout.name === active)}
        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span class="text-xs text-[var(--color-text-muted)]">{i18n.t.deck.currentLayout.replace('{name}', displayName(active))}</span>
          <button type="button" disabled={busy} onclick={updateCurrent} class="action">{i18n.t.deck.updateWorkspace}</button>
        </div>
      {/if}
    </form>

    {#if error}<p role="alert" class="text-sm text-red-400">{error}</p>{/if}
    {#if message}<p role="status" class="text-sm text-[var(--color-primary-text)]">{message}</p>{/if}
    {#if warning}<p role="status" class="text-sm text-amber-500">{warning}</p>{/if}

    <div class="space-y-3">
      {#if layouts.length === 0}
        <p class="py-6 text-center text-sm text-[var(--color-text-muted)]">{i18n.t.deck.noLayouts}</p>
      {/if}
      {#each layouts as layout (layout.name)}
        <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3" aria-label={displayName(layout.name)}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <h3 class="font-medium text-sm break-words">{displayName(layout.name)}</h3>
              <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.deck.col.replace('{count}', String(layout.columns.length))}</p>
            </div>
            <button type="button" disabled={busy} class="action" onclick={() => switchTo(layout.name)}>{i18n.t.deck.switchLayout}</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" disabled={busy} class="action" onclick={() => { renaming = layout.name; renamed = displayName(layout.name); deleting = null; }}><Pencil size={13} />{i18n.t.deck.renameLayout}</button>
            <button type="button" disabled={busy} class="action" onclick={() => duplicate(layout.name)}><Copy size={13} />{i18n.t.deck.duplicateLayout}</button>
            <button type="button" disabled={busy} class="action" onclick={() => download([layout])}><Download size={13} />{i18n.t.deck.exportWorkspace}</button>
            <button type="button" disabled={busy} class="action" onclick={() => { deleting = layout.name; renaming = null; }}><Trash2 size={13} />{i18n.t.deck.deleteLayout}</button>
          </div>
          {#if renaming === layout.name}
            <form onsubmit={(event) => { event.preventDefault(); rename(layout.name); }} class="flex flex-wrap gap-2">
              <input bind:value={renamed} maxlength={MAX_WORKSPACE_NAME_LENGTH} aria-label={i18n.t.deck.newLayoutName} required class="flex-1 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
              <button type="submit" disabled={busy || !renamed.trim()} class="action primary">{i18n.t.deck.save}</button>
              <button type="button" class="action" onclick={() => renaming = null}>{i18n.t.common.cancel}</button>
            </form>
          {/if}
          {#if deleting === layout.name}
            <div class="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              <p class="text-sm">{i18n.t.deck.deleteWorkspaceConfirm.replace('{name}', displayName(layout.name))}</p>
              <div class="flex flex-wrap gap-2">
                <button type="button" disabled={busy} class="action text-red-400" onclick={() => remove(layout.name)}>{i18n.t.deck.confirmDeleteWorkspace}</button>
                <button type="button" class="action" onclick={() => deleting = null}>{i18n.t.common.cancel}</button>
              </div>
            </div>
          {/if}
        </section>
      {/each}
    </div>

    <section class="space-y-3 border-t border-[var(--color-border)] pt-4">
      <div class="flex flex-wrap gap-2">
        <button type="button" disabled={busy || layouts.length === 0} class="action" onclick={() => download(layouts)}><Download size={14} />{i18n.t.deck.exportAllWorkspaces}</button>
        <button type="button" disabled={busy} class="action" onclick={() => fileInput.click()}><Upload size={14} />{i18n.t.deck.importWorkspaces}</button>
        <input bind:this={fileInput} type="file" accept=".json,application/json" class="hidden" aria-label={i18n.t.deck.importWorkspaces} onchange={importFile} />
      </div>
      <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.deck.importWorkspaceHint}</p>
      <p class="text-xs text-[var(--color-text-muted)]">{i18n.t.deck.portableWorkspaceHint}</p>
    </section>
  </div>
</dialog>

<style>
  .workspace-dialog { padding: 0; margin: auto; width: min(46rem, calc(100vw - 2rem)); max-height: min(88dvh, 56rem); }
  .workspace-dialog::backdrop { background: rgb(0 0 0 / 0.6); }
  .workspace-content { overflow-y: auto; max-height: calc(min(88dvh, 56rem) - 4.5rem); }
  .action { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; padding: 0.5rem 0.625rem; font-size: 0.75rem; border: 1px solid var(--color-border); border-radius: 0.5rem; min-height: 2.25rem; }
  .action:hover:not(:disabled) { background: var(--color-surface-hover); }
  .action:disabled { opacity: 0.5; cursor: not-allowed; }
  .action.primary { color: white; background: var(--color-primary); border-color: var(--color-primary); }
</style>
