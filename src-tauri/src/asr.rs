//! CrispASR integration — translation (NMT), text-to-speech, speech-to-text.
//!
//! Mirrors CrispSorter's pattern: optional sibling path-dep
//! (`../../CrispASR/crispasr`) gated behind the `crispasr` cargo feature.
//! Without the feature, all commands return a clear error message.
//!
//! Backend auto-resolution: on first use, `crispasr::registry_lookup`
//! finds the canonical GGUF URL and `crispasr::cache_ensure_file`
//! downloads it to the model cache dir. Subsequent calls reuse the
//! cached model.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

// ── Types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TranslateResult {
    pub translated: String,
    #[serde(rename = "srcLang")]
    pub src_lang: String,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscribeSegment {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscribeResult {
    pub text: String,
    pub segments: Vec<TranscribeSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AsrConfig {
    pub backend: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_path: Option<String>,
}

impl Default for AsrConfig {
    fn default() -> Self {
        Self {
            backend: "m2m100".to_string(),
            model_path: None,
        }
    }
}

// ── Session wrapper ───────────────────────────────────────────────────────

struct SessionSlot {
    #[cfg(feature = "crispasr")]
    session: Option<crispasr::Session>,
    #[cfg(not(feature = "crispasr"))]
    _session: Option<()>,
    config: AsrConfig,
}

pub struct AsrHandle {
    pub(crate) slot: Arc<Mutex<SessionSlot>>,
    #[allow(dead_code)]
    cache_dir: PathBuf,
}

impl AsrHandle {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            slot: Arc::new(Mutex::new(SessionSlot {
                #[cfg(feature = "crispasr")]
                session: None,
                #[cfg(not(feature = "crispasr"))]
                _session: None,
                config: AsrConfig::default(),
            })),
            cache_dir,
        }
    }

    #[cfg(feature = "crispasr")]
    async fn ensure_session(&self, config: &AsrConfig) -> Result<(), String> {
        let mut guard = self.slot.lock().await;
        if guard.session.is_some() && guard.config == *config {
            return Ok(());
        }

        let backend = config.backend.clone();
        let cache_dir = self.cache_dir.to_string_lossy().into_owned();

        // Resolve model path: explicit > registry auto-download
        let model_path = if let Some(p) = config.model_path.clone() {
            p
        } else {
            let b = backend.clone();
            let c = cache_dir.clone();
            tokio::task::spawn_blocking(move || -> Result<String, String> {
                let entry = crispasr::registry_lookup(&b)
                    .map_err(|e| format!("registry lookup failed: {e}"))?
                    .ok_or_else(|| format!("backend `{b}` not in CrispASR registry"))?;
                crispasr::cache_ensure_file(&entry.filename, &entry.url, false, Some(&c))
                    .map_err(|e| format!("model download failed: {e}"))?
                    .ok_or_else(|| format!("cache returned no path for {}", entry.filename))
            })
            .await
            .map_err(|e| format!("spawn_blocking: {e}"))??
        };

        log::info!("[asr] Loading: backend={backend} path={model_path}");
        let b2 = backend.clone();
        let session = tokio::task::spawn_blocking(move || {
            crispasr::Session::open_with_backend(&model_path, &b2, 4)
                .map_err(|e| format!("Session::open failed: {e}"))
        })
        .await
        .map_err(|e| format!("spawn_blocking: {e}"))??;

        log::info!("[asr] Session ready, backend: {}", session.backend());
        guard.session = Some(session);
        guard.config = config.clone();
        Ok(())
    }

    #[cfg(not(feature = "crispasr"))]
    async fn ensure_session(&self, _config: &AsrConfig) -> Result<(), String> {
        Err("CrispASR not available — rebuild with --features crispasr-metal (macOS), \
             crispasr-vulkan (Windows/Linux), or crispasr-cuda (NVIDIA)."
            .into())
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ModelEntry {
    pub name: String,
    pub filename: String,
    pub approx_size: String,
    pub url: String,
}

#[tauri::command]
pub fn asr_available() -> bool {
    cfg!(feature = "crispasr")
}

/// List all models in the CrispASR registry, grouped by capability.
#[tauri::command]
pub fn asr_list_models() -> Result<Vec<ModelEntry>, String> {
    #[cfg(feature = "crispasr")]
    {
        let names = crispasr::list_known_models();
        let mut seen = std::collections::HashSet::new();
        let mut entries = Vec::new();
        for name in names {
            if !seen.insert(name.clone()) { continue; }
            if let Ok(Some(entry)) = crispasr::registry_lookup(&name) {
                entries.push(ModelEntry {
                    name,
                    filename: entry.filename,
                    approx_size: entry.approx_size,
                    url: entry.url,
                });
            }
        }
        Ok(entries)
    }
    #[cfg(not(feature = "crispasr"))]
    Err("crispasr feature disabled".into())
}

#[tauri::command]
pub async fn translate_text(
    state: tauri::State<'_, AsrHandle>,
    backend: String,
    model_path: Option<String>,
    text: String,
    src_lang: String,
    tgt_lang: String,
    max_tokens: Option<i32>,
) -> Result<TranslateResult, String> {
    let config = AsrConfig {
        backend: backend.clone(),
        model_path,
    };
    state.ensure_session(&config).await?;

    #[cfg(feature = "crispasr")]
    {
        let guard = state.slot.lock().await;
        let sess = guard.session.as_ref().unwrap();
        let translated =
            sess.translate_text(&text, &src_lang, &tgt_lang, max_tokens.unwrap_or(200))
                .map_err(|e| format!("{e}"))?;
        Ok(TranslateResult {
            translated,
            src_lang,
            backend: sess.backend(),
        })
    }

    #[cfg(not(feature = "crispasr"))]
    Err("crispasr feature disabled".into())
}

#[tauri::command]
pub async fn transcribe_audio(
    state: tauri::State<'_, AsrHandle>,
    backend: Option<String>,
    model_path: Option<String>,
    pcm: Vec<f32>,
    language: Option<String>,
) -> Result<TranscribeResult, String> {
    let config = AsrConfig {
        backend: backend.unwrap_or_else(|| "whisper".to_string()),
        model_path,
    };
    state.ensure_session(&config).await?;

    #[cfg(feature = "crispasr")]
    {
        let guard = state.slot.lock().await;
        let sess = guard.session.as_ref().unwrap();
        let segments = sess
            .transcribe_with_language(&pcm, language.as_deref())
            .map_err(|e| format!("{e}"))?;
        let mut full_text = String::new();
        let mut typed = Vec::new();
        for seg in segments {
            let trimmed = seg.text.trim();
            if !full_text.is_empty() && !trimmed.is_empty() {
                full_text.push(' ');
            }
            full_text.push_str(trimmed);
            typed.push(TranscribeSegment {
                text: trimmed.to_string(),
                start: seg.start,
                end: seg.end,
            });
        }
        Ok(TranscribeResult {
            text: full_text,
            segments: typed,
        })
    }

    #[cfg(not(feature = "crispasr"))]
    Err("crispasr feature disabled".into())
}

#[tauri::command]
pub async fn synthesize_speech(
    state: tauri::State<'_, AsrHandle>,
    backend: Option<String>,
    model_path: Option<String>,
    text: String,
) -> Result<Vec<f32>, String> {
    let config = AsrConfig {
        backend: backend.unwrap_or_else(|| "kokoro".to_string()),
        model_path,
    };
    state.ensure_session(&config).await?;

    #[cfg(feature = "crispasr")]
    {
        let guard = state.slot.lock().await;
        let sess = guard.session.as_ref().unwrap();
        sess.synthesize(&text).map_err(|e| format!("{e}"))
    }

    #[cfg(not(feature = "crispasr"))]
    Err("crispasr feature disabled".into())
}

#[tauri::command]
pub async fn asr_backend_name(
    state: tauri::State<'_, AsrHandle>,
) -> Result<String, String> {
    #[cfg(feature = "crispasr")]
    {
        let guard = state.slot.lock().await;
        match guard.session.as_ref() {
            Some(sess) => Ok(sess.backend()),
            None => Ok("(no session loaded)".to_string()),
        }
    }

    #[cfg(not(feature = "crispasr"))]
    Ok("(crispasr feature disabled)".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asr_config_default() {
        let cfg = AsrConfig::default();
        assert_eq!(cfg.backend, "m2m100");
        assert!(cfg.model_path.is_none());
    }

    #[test]
    fn asr_config_serde_round_trip() {
        let cfg = AsrConfig {
            backend: "whisper".to_string(),
            model_path: None,
        };
        let s = serde_json::to_string(&cfg).unwrap();
        assert_eq!(s, r#"{"backend":"whisper"}"#);
        let back: AsrConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn asr_config_with_model_path() {
        let cfg = AsrConfig {
            backend: "m2m100".to_string(),
            model_path: Some("/tmp/m2m100-418m-q4_k.gguf".to_string()),
        };
        let s = serde_json::to_string(&cfg).unwrap();
        let back: AsrConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(back, cfg);
        assert_eq!(back.model_path.as_deref(), Some("/tmp/m2m100-418m-q4_k.gguf"));
    }

    #[test]
    fn asr_available_reflects_feature() {
        // Without the feature, asr_available returns false
        let result = asr_available();
        assert_eq!(result, cfg!(feature = "crispasr"));
    }
}
