/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDraftAIAction, type AIDraft } from './ai-draft';
import { recordAIContribution } from './ai-provenance';
import type { AIResult } from './ai';

const runAIAction = vi.hoisted(() => vi.fn());
vi.mock('./ai', () => ({ runAIAction }));
const config = { provider: 'openai' as const, baseUrl: 'https://api.tokenfactory.nebius.com/v1', apiKey: 'test-key', model: 'vendor/text' };
const result = (action: AIResult['action']): AIResult => ({ text: 'Generated result', action, provider: 'openai', provenance: recordAIContribution(action, config, action === 'alt-text') });

beforeEach(() => { runAIAction.mockReset(); });

describe('AI requests belong to a specific draft', () => {
  it.each(['correct', 'shorten', 'hashtags'] as const)('rejects an in-flight %s result after reset or snapshot replacement, even when text is identical', async action => {
    let finish!: (value: AIResult) => void;
    runAIAction.mockImplementation(() => new Promise<AIResult>(resolve => { finish = resolve; }));
    let draft: AIDraft = { generation: 1, text: 'The original draft', mediaFiles: [], altTexts: [] };
    const pending = runDraftAIAction(action, () => draft);
    expect(runAIAction).toHaveBeenCalledOnce();
    draft = { ...draft, generation: 2, text: 'The original draft' };
    finish(result(action));
    expect(await pending).toEqual({ status: 'stale' });
    expect(draft.text).toBe('The original draft');
  });

  it('sends the actual first undescribed image, skips video, and returns its target index', async () => {
    runAIAction.mockResolvedValue(result('alt-text'));
    const draft: AIDraft = { generation: 1, text: 'User text', mediaFiles: [
      new File(['video'], 'video.mp4', { type: 'video/mp4' }),
      new File(['already described'], 'first.png', { type: 'image/png' }),
      new File(['image data'], 'target.png', { type: 'image/png' }),
    ], altTexts: ['', 'Existing description', ''] };
    const outcome = await runDraftAIAction('alt-text', () => draft);
    expect(runAIAction).toHaveBeenCalledWith('alt-text', expect.any(String), undefined, 'data:image/png;base64,aW1hZ2UgZGF0YQ==');
    expect(outcome).toMatchObject({ status: 'ready', mediaIndex: 2, result: { text: 'Generated result' } });
  });

  it('rejects alt-text after a snapshot/reset generation changes while keeping the same File identity', async () => {
    let finish!: (value: AIResult) => void;
    runAIAction.mockImplementation(() => new Promise<AIResult>(resolve => { finish = resolve; }));
    let draft: AIDraft = { generation: 1, text: '', mediaFiles: [new File(['image'], 'same.png', { type: 'image/png' })], altTexts: [''] };
    const file = draft.mediaFiles[0];
    const pending = runDraftAIAction('alt-text', () => draft);
    await vi.waitFor(() => expect(runAIAction).toHaveBeenCalledOnce());
    draft = { ...draft, generation: 2, mediaFiles: [file] };
    finish(result('alt-text'));
    expect(await pending).toEqual({ status: 'stale' });
    expect(draft.altTexts).toEqual(['']);
  });

  it('does not overwrite a human image description edited while generation is pending', async () => {
    let finish!: (value: AIResult) => void;
    runAIAction.mockImplementation(() => new Promise<AIResult>(resolve => { finish = resolve; }));
    const draft: AIDraft = { generation: 1, text: '', mediaFiles: [new File(['image'], 'same.png', { type: 'image/png' })], altTexts: [''] };
    const pending = runDraftAIAction('alt-text', () => draft);
    await vi.waitFor(() => expect(runAIAction).toHaveBeenCalledOnce());
    draft.altTexts[0] = 'My description';
    finish(result('alt-text'));
    expect(await pending).toEqual({ status: 'stale' });
    expect(draft.altTexts[0]).toBe('My description');
  });

  it('does not ask a model to describe an absent image or a video', async () => {
    const draft: AIDraft = { generation: 1, text: '', mediaFiles: [new File(['video'], 'video.mp4', { type: 'video/mp4' })], altTexts: [''] };
    expect(await runDraftAIAction('alt-text', () => draft)).toEqual({ status: 'no-image' });
    expect(runAIAction).not.toHaveBeenCalled();
  });
});
