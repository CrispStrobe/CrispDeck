// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
const native = vi.hoisted(() => ({ isTauri: vi.fn(), openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));
import { openExternalLink } from './external-link';
const url = 'https://www.freiheitmachtpolitik.de/podcast/fm-politik';
beforeEach(() => { vi.clearAllMocks(); native.isTauri.mockReturnValue(true); native.openUrl.mockResolvedValue(undefined); });
describe('native external links', () => {
  it('opens the actual URL with the native opener', async () => {
    const event = new MouseEvent('click', { cancelable:true });
    openExternalLink(event, url, vi.fn());
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(native.openUrl).toHaveBeenCalledWith(url));
  });
  it('reports opener failures', async () => {
    native.openUrl.mockRejectedValue(new Error('failed')); const error=vi.fn();
    openExternalLink(new MouseEvent('click',{cancelable:true}),url,error);
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  });
  it('does not intercept browser clicks or open unsafe schemes', async () => {
    native.isTauri.mockReturnValue(false); const event=new MouseEvent('click',{cancelable:true});
    openExternalLink(event,url,vi.fn()); expect(event.defaultPrevented).toBe(false);
    native.isTauri.mockReturnValue(true); openExternalLink(new MouseEvent('click'), 'javascript:alert(1)',vi.fn());
    await Promise.resolve(); expect(native.openUrl).not.toHaveBeenCalled();
  });
});
