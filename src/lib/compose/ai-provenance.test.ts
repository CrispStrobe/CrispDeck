import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAIAction, type AIComposeConfig } from './ai';
import { editContributions, exportComposeRecord, publicDisclosure, recordAIContribution, removeMediaContributions, textContributions } from './ai-provenance';

const config: AIComposeConfig = { provider: 'openai', baseUrl: 'https://api.studio.nebius.com/v1/', apiKey: 'private-api-key', model: 'vendor/text', visionModel: 'vendor/vision' };
afterEach(() => vi.unstubAllGlobals());

describe('AI output provenance', () => {
  it('records the effective provider and vision model while preserving the generated string', async () => {
    const generated = '<description>A cat & a keyboard.</description>';
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: generated } }] }) });
    vi.stubGlobal('fetch', fetch);
    const result = await runAIAction('alt-text', 'private prompt', config, 'data:image/png;base64,AAAA');
    expect(fetch.mock.calls[0][0]).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('vendor/vision');
    expect(result.text).toBe(generated);
    expect(result.provenance).toMatchObject({ origin: 'ai-generated', operation: 'alt-text', target: 'alt-text', provider: 'nebius', requested_model: 'vendor/vision', reviewed: false });
    const exported = exportComposeRecord('The author’s own post', [result.text], [{ ...result.provenance, media_index: 0 }]);
    expect(exported).not.toContain('private-api-key');
    expect(exported).not.toContain('private prompt');
    expect(exported).not.toContain('data:image');
    expect(JSON.parse(exported).image_descriptions[0].text).toBe(generated);
  });

  it('distinguishes corrections, summaries, and generated portions without labeling the entire post generated', () => {
    const correction = recordAIContribution('correct', config, false);
    const shorter = recordAIContribution('shorten', config, false);
    const tags = recordAIContribution('hashtags', config, false);
    expect(correction.origin).toBe('ai-assisted');
    expect(shorter.origin).toBe('ai-assisted');
    expect(tags.origin).toBe('ai-generated');
    expect(publicDisclosure([correction], 'Assisted text', 'Generated hashtags')).toBe('');
    expect(publicDisclosure([shorter], 'Assisted text', 'Generated hashtags')).toBe('Assisted text');
    expect(publicDisclosure([tags], 'Assisted text', 'Generated hashtags')).toBe('Generated hashtags');
  });

  it('keeps history after editing, revokes old review, and resets only the replaced field', () => {
    const body = { ...recordAIContribution('shorten', config, false), reviewed: true };
    const alt = { ...recordAIContribution('alt-text', config, true), media_index: 0, reviewed: true };
    const edited = editContributions([body, alt], 'text', 'A human edit');
    expect(edited[0]).toMatchObject({ modified_after_generation: true, reviewed: false });
    expect(edited[1]).toEqual(alt);
    expect(editContributions(edited, 'text', 'Entirely new post', true)).toEqual([alt]);
    expect(editContributions(edited, 'text', '')).toEqual([alt]);
    expect(editContributions(edited, 'alt-text', 'New description', true, 0)).toEqual([edited[0]]);
    expect(textContributions(edited)).toEqual([edited[0]]);
  });

  it('keeps image attribution attached to the correct image after removal', () => {
    const base = recordAIContribution('alt-text', config, true);
    const body = recordAIContribution('hashtags', config, false);
    const records = [body, { ...base, media_index: 0 }, { ...base, media_index: 2 }];
    expect(removeMediaContributions(records, 0)).toEqual([body, { ...base, media_index: 1 }]);
    expect(publicDisclosure([base], 'Assisted text', 'Generated hashtags')).toBe('');
  });

  it('does not export custom endpoint credentials or absolute model paths', () => {
    const record = recordAIContribution('correct', { ...config, baseUrl: 'https://user:password@private.example/proxy?token=secret', model: '/Users/PrivatePerson/model.gguf' }, false);
    expect(record.provider).toBe('custom-openai-compatible');
    expect(record.requested_model).toBeUndefined();
    const output = JSON.stringify(record);
    expect(output).not.toMatch(/password|private\.example|token=|PrivatePerson|private-api-key/);
    expect(recordAIContribution('correct', { ...config, model: 'C:\\Users\\PrivatePerson\\model.gguf' }, false).requested_model).toBeUndefined();
  });
});
