/**
 * AI compose assistance — text correction, shortening, hashtag suggestions,
 * and alt-text generation via multiple backends:
 *
 * 1. BYOK OpenAI-compatible — user provides endpoint + key (Ollama, llama.cpp, Groq, etc.)
 * 2. CrispASR (Tauri desktop) — bundled llama.cpp, runs locally, no API key
 * 3. mistral.rs (Tauri desktop) — Rust-native inference, runs locally, no API key
 *
 * For alt-text: supports image-to-text via vision models (multimodal).
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type AIAction = 'correct' | 'shorten' | 'hashtags' | 'alt-text';

export type AIProvider = 'openai' | 'crispasr' | 'mistral-rs';

export interface AIComposeConfig {
  provider: AIProvider;
  // BYOK OpenAI-compatible
  presetId?: string; // provider preset ID from byok-providers.ts
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string; // model to use for alt-text (vision/multimodal)
  // CrispASR (llama.cpp bundled)
  crispasrModel?: string;
  // mistral.rs
  mistralrsModel?: string;
}

export interface AIResult {
  text: string;
  action: AIAction;
  provider: AIProvider;
}

// ── Config persistence ────────────────────────────────────────────────────

const CONFIG_KEY = 'crispdeck-ai-compose-config';

const DEFAULT_CONFIG: AIComposeConfig = {
  provider: 'openai',
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
  switch (config.provider) {
    case 'openai':
      return !!config.apiKey;
    case 'crispasr':
    case 'mistral-rs':
      // Desktop providers need no API key — just need to be running in Tauri
      return true;
    default:
      return !!config.apiKey;
  }
}

// ── System prompts per action ─────────────────────────────────────────────

const PROMPTS: Record<AIAction, string> = {
  correct: `You are a writing assistant. Fix typos, grammar, and punctuation in the user's text. Preserve the original meaning, tone, and length as closely as possible. Do NOT add or remove content. Return ONLY the corrected text, nothing else.`,

  shorten: `You are a writing assistant. Shorten the user's text while preserving the key message. Make it concise and punchy. Target roughly half the original length. Return ONLY the shortened text, nothing else.`,

  hashtags: `You are a social media assistant. Suggest 3-5 relevant hashtags for the user's post. Return ONLY the hashtags separated by spaces (e.g. #topic1 #topic2 #topic3), nothing else. Do not include the original text.`,

  'alt-text': `You are an accessibility expert. Write a concise, descriptive alt text for the image. The alt text should be 1-2 sentences, factual, and useful for screen reader users. Return ONLY the alt text, nothing else.`,
};

// ── Provider: BYOK OpenAI-compatible ─────────────────────────────────────

async function runWithOpenAI(
  action: AIAction,
  input: string,
  cfg: AIComposeConfig,
  imageDataUrl?: string,
): Promise<string> {
  if (!cfg.apiKey) {
    throw new Error('AI API key not configured. Set it in Settings → AI Compose.');
  }

  const baseUrl = cfg.baseUrl.replace(/\/$/, '');
  const systemPrompt = PROMPTS[action];

  // Build messages — use vision format if we have an image
  const userContent: any = imageDataUrl
    ? [
        { type: 'text', text: input || 'Describe this image for alt text.' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]
    : input;

  // Use vision model for alt-text when an image is provided
  const model = (action === 'alt-text' && imageDataUrl && cfg.visionModel)
    ? cfg.visionModel
    : cfg.model;

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
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
  return (data as any).choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Provider: CrispASR (bundled llama.cpp) ───────────────────────────────

/**
 * Local AI via CrispASR's bundled llama.cpp backend.
 * Runs on CPU/GPU natively — no API key, fully offline.
 * Supports text models and multimodal (LLaVA) for alt-text.
 */
async function runWithCrispASR(
  action: AIAction,
  input: string,
  cfg: AIComposeConfig,
  imageDataUrl?: string,
): Promise<string> {
  const w = globalThis as any;
  if (!w.__TAURI_INTERNALS__) {
    throw new Error(
      'CrispASR requires the desktop app. Use "BYOK" with Ollama or any OpenAI-compatible endpoint for web.',
    );
  }

  const { invoke } = await import('@tauri-apps/api/core');

  const available = await invoke('asr_available') as boolean;
  if (!available) {
    throw new Error(
      'CrispASR not compiled in this build. Rebuild with --features crispasr-metal (macOS), ' +
      'crispasr-vulkan (Windows/Linux), or crispasr-cuda (NVIDIA).',
    );
  }

  const model = cfg.crispasrModel || (action === 'alt-text' ? 'llava-v1.6' : 'mistral-7b');

  const result = await invoke('llm_generate', {
    backend: 'llama-cpp',
    modelPath: null, // auto-download from registry
    modelName: model,
    systemPrompt: PROMPTS[action],
    userPrompt: input || 'Describe this image for alt text.',
    imageBase64: imageDataUrl?.replace(/^data:image\/\w+;base64,/, '') ?? null,
    maxTokens: action === 'hashtags' ? 100 : 1024,
    temperature: action === 'correct' ? 0.1 : 0.5,
  });

  return (result as { text: string }).text?.trim() ?? '';
}

// ── Provider: mistral.rs (Rust-native inference) ─────────────────────────

/**
 * Local AI via mistral.rs — Rust-native transformer inference.
 * Faster than llama.cpp for some model architectures.
 * Supports vision models (e.g., Idefics, Phi-3-Vision) for alt-text.
 */
async function runWithMistralRS(
  action: AIAction,
  input: string,
  cfg: AIComposeConfig,
  imageDataUrl?: string,
): Promise<string> {
  const w = globalThis as any;
  if (!w.__TAURI_INTERNALS__) {
    throw new Error(
      'mistral.rs requires the desktop app. Use "BYOK" with any OpenAI-compatible endpoint for web.',
    );
  }

  const { invoke } = await import('@tauri-apps/api/core');

  const available = await invoke('mistralrs_available') as boolean;
  if (!available) {
    throw new Error(
      'mistral.rs not compiled in this build. Rebuild with --features mistralrs.',
    );
  }

  const model = cfg.mistralrsModel || (action === 'alt-text' ? 'phi-3-vision' : 'mistral-7b-instruct');

  const result = await invoke('mistralrs_generate', {
    modelName: model,
    systemPrompt: PROMPTS[action],
    userPrompt: input || 'Describe this image for alt text.',
    imageBase64: imageDataUrl?.replace(/^data:image\/\w+;base64,/, '') ?? null,
    maxTokens: action === 'hashtags' ? 100 : 1024,
    temperature: action === 'correct' ? 0.1 : 0.5,
  });

  return (result as { text: string }).text?.trim() ?? '';
}

// ── Main entry point ─────────────────────────────────────────────────────

export async function runAIAction(
  action: AIAction,
  input: string,
  config?: AIComposeConfig,
  imageDataUrl?: string,
): Promise<AIResult> {
  const cfg = config ?? getAIComposeConfig();

  let text: string;

  switch (cfg.provider) {
    case 'crispasr':
      text = await runWithCrispASR(action, input, cfg, imageDataUrl);
      break;
    case 'mistral-rs':
      text = await runWithMistralRS(action, input, cfg, imageDataUrl);
      break;
    case 'openai':
    default:
      text = await runWithOpenAI(action, input, cfg, imageDataUrl);
      break;
  }

  if (!text) {
    throw new Error('AI returned empty response');
  }

  return { text, action, provider: cfg.provider };
}
