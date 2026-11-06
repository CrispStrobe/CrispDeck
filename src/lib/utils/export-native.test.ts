/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), error: vi.fn() }));
vi.mock('$lib/platform', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.write }));
vi.mock('$lib/toast.svelte', () => ({ toast: { error: mocks.error } }));
import { triggerDownload } from './export';

describe('native exports', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('asks for a destination and writes the selected file', async () => {
    mocks.save.mockResolvedValue('/chosen/report.json');
    mocks.write.mockResolvedValue(undefined);
    triggerDownload('{"ok":true}', 'application/json', 'report.json');
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledWith('/chosen/report.json', '{"ok":true}'));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'report.json' }));
  });
  it('does not write when cancelled and reports save failures', async () => {
    mocks.save.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('failed'));
    triggerDownload('test', 'text/plain', 'report.txt');
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.write).not.toHaveBeenCalled();
    triggerDownload('test', 'text/plain', 'report.txt');
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
  });
});
