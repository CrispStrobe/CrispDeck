import { normalizeProviderBase, PROVIDER_PRESETS } from '$lib/byok-providers';
import type { AIAction, AIComposeConfig } from './ai';

/** Local application records, not signed credentials or a statistical watermark. */
export interface AIContribution {
  schema_version: 1;
  application: 'CrispDeck';
  operation: AIAction;
  origin: 'ai-assisted' | 'ai-generated';
  provider: string;
  requested_model?: string;
  generated_at: string;
  target: 'text' | 'alt-text';
  media_index?: number;
  modified_after_generation: boolean;
  reviewed: boolean;
}

function portableModel(model: string | undefined): string | undefined {
  const value = model?.trim();
  // Do not export local file paths, URL credentials, or user-entered endpoints.
  return value && !/^(?:[~\\/]|[a-z]:[\\/]|[a-z][a-z\d+.-]*:)/i.test(value) ? value : undefined;
}

export function recordAIContribution(action: AIAction, config: AIComposeConfig, hasImage: boolean): AIContribution {
  const base = normalizeProviderBase(config.baseUrl);
  const provider = config.provider === 'openai'
    ? PROVIDER_PRESETS.find(p => normalizeProviderBase(p.baseUrl) === base)?.id ?? 'custom-openai-compatible'
    : config.provider;
  const model = portableModel(config.provider === 'crispasr'
    ? config.crispasrModel || (action === 'alt-text' ? 'llava-v1.6' : 'mistral-7b')
    : config.provider === 'mistral-rs'
      ? config.mistralrsModel || (action === 'alt-text' ? 'phi-3-vision' : 'mistral-7b-instruct')
      : action === 'alt-text' && hasImage && config.visionModel ? config.visionModel : config.model);
  return {
    schema_version: 1, application: 'CrispDeck', operation: action,
    origin: action === 'correct' || action === 'shorten' ? 'ai-assisted' : 'ai-generated',
    provider, ...(model ? { requested_model: model } : {}), generated_at: new Date().toISOString(),
    target: action === 'alt-text' ? 'alt-text' : 'text',
    modified_after_generation: false, reviewed: false,
  };
}

export function editContributions(records: AIContribution[], target: AIContribution['target'], value: string, replaced = false, mediaIndex?: number): AIContribution[] {
  const matches = (record: AIContribution) => record.target === target && (target === 'text' || record.media_index === mediaIndex);
  if (replaced || !value.trim()) return records.filter(record => !matches(record));
  return records.map(record => matches(record) ? { ...record, modified_after_generation: true, reviewed: false } : record);
}

export function removeMediaContributions(records: AIContribution[], index: number): AIContribution[] {
  return records.filter(record => record.target !== 'alt-text' || record.media_index !== index)
    .map(record => record.target === 'alt-text' && record.media_index !== undefined && record.media_index > index
      ? { ...record, media_index: record.media_index - 1 } : record);
}

export function textContributions(records: AIContribution[]): AIContribution[] {
  return records.filter(record => record.target === 'text').map(record => ({ ...record }));
}

/** The original author's whole post must not be described as wholly AI-generated. */
export function publicDisclosure(records: AIContribution[], assistedText: string, generatedHashtags: string): string {
  if (records.some(record => record.target === 'text' && record.operation === 'shorten')) return assistedText;
  if (records.some(record => record.target === 'text' && record.operation === 'hashtags')) return generatedHashtags;
  return '';
}

export function exportComposeRecord(text: string, altTexts: string[], records: AIContribution[]): string {
  return JSON.stringify({
    schema: 'crisp-ai-output-record', schema_version: 1, application: 'CrispDeck',
    marking: 'application-authored provenance; not a watermark or signed credential',
    scope: 'composer base text and image descriptions; destination overrides are not covered',
    text, image_descriptions: altTexts.map((text, media_index) => ({ media_index, text })),
    contributions: records,
  }, null, 2);
}
