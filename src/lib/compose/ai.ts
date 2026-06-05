/**
 * AI compose assistance — text correction, shortening, hashtag suggestions,
 * and alt-text generation via BYOK OpenAI-compatible endpoint.
 *
 * Reuses the same BYOK pattern as translate.ts.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type AIAction = 'correct' | 'shorten' | 'hashtags' | 'alt-text';

export interface AIComposeConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AIResult {
  text: string;
  action: AIAction;
}

// ── Config persistence ────────────────────────────────────────────────────

const CONFIG_KEY = 'crispdeck-ai-compose-config';

const DEFAULT_CONFIG: AIComposeConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export function getAIComposeConfig(): AIComposeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setAIComposeConfig(config: Partial<AIComposeConfig>): void {
  const current = getAIComposeConfig();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...current, ...config }));
}

export function isAIConfigured(): boolean {
  const config = getAIComposeConfig();
  return !!config.apiKey;
}

// ── System prompts per action ─────────────────────────────────────────────

const PROMPTS: Record<AIAction, string> = {
  correct: `You are a writing assistant. Fix typos, grammar, and punctuation in the user's text. Preserve the original meaning, tone, and length as closely as possible. Do NOT add or remove content. Return ONLY the corrected text, nothing else.`,

  shorten: `You are a writing assistant. Shorten the user's text while preserving the key message. Make it concise and punchy. Target roughly half the original length. Return ONLY the shortened text, nothing else.`,

  hashtags: `You are a social media assistant. Suggest 3-5 relevant hashtags for the user's post. Return ONLY the hashtags separated by spaces (e.g. #topic1 #topic2 #topic3), nothing else. Do not include the original text.`,

  'alt-text': `You are an accessibility expert. Write a concise, descriptive alt text for the image described by the user. The alt text should be 1-2 sentences, factual, and useful for screen reader users. Return ONLY the alt text, nothing else.`,
};

// ── API call ──────────────────────────────────────────────────────────────

export async function runAIAction(
  action: AIAction,
  input: string,
  config?: AIComposeConfig,
): Promise<AIResult> {
  const cfg = config ?? getAIComposeConfig();

  if (!cfg.apiKey) {
    throw new Error('AI API key not configured. Set it in Settings → AI Compose.');
  }

  const baseUrl = cfg.baseUrl.replace(/\/$/, '');
  const systemPrompt = PROMPTS[action];

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      temperature: action === 'correct' ? 0.1 : 0.5,
      max_tokens: action === 'hashtags' ? 100 : 1024,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error?.message ?? `AI API error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = (data as any).choices?.[0]?.message?.content?.trim() ?? '';

  if (!text) {
    throw new Error('AI returned empty response');
  }

  return { text, action };
}
