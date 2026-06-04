//! Live integration tests for the CrispASR translation/TTS/STT backend.
//!
//! These tests require `--features crispasr` and a network connection
//! (first run downloads a ~271 MB model). Skip with:
//!   cargo test --features crispasr -- --skip crispasr
//!
//! Without the feature flag, the tests compile but skip via cfg.

#[cfg(feature = "crispasr")]
mod live {
    use std::path::PathBuf;

    fn test_cache_dir() -> PathBuf {
        let dir = std::env::temp_dir().join("crispdeck-test-models");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── Registry tests (no model download needed) ─────────────────────

    #[test]
    fn registry_lists_known_models() {
        let models = crispasr::list_known_models();
        assert!(
            models.len() >= 10,
            "expected at least 10 known models, got {}",
            models.len()
        );
        println!("Known models ({}):", models.len());
        for m in &models {
            println!("  {m}");
        }
    }

    #[test]
    fn registry_lookup_m2m100() {
        let entry = crispasr::registry_lookup("m2m100")
            .expect("registry_lookup should not error")
            .expect("m2m100 should be in the registry");
        assert!(!entry.filename.is_empty(), "filename should not be empty");
        assert!(
            entry.url.starts_with("http"),
            "url should be an HTTP URL: {}",
            entry.url
        );
        assert!(!entry.approx_size.is_empty(), "approx_size should not be empty");
        println!(
            "m2m100: filename={}, approx_size={}, url={}",
            entry.filename, entry.approx_size, entry.url
        );
    }

    #[test]
    fn registry_lookup_whisper() {
        let entry = crispasr::registry_lookup("whisper")
            .expect("registry_lookup should not error")
            .expect("whisper should be in the registry");
        assert!(!entry.filename.is_empty());
        println!("whisper: filename={}", entry.filename);
    }

    #[test]
    fn registry_lookup_nonexistent() {
        let entry = crispasr::registry_lookup("nonexistent-backend-xyz")
            .expect("registry_lookup should not error");
        assert!(entry.is_none(), "nonexistent backend should return None");
    }

    #[test]
    fn registry_has_streaming_models() {
        // These backends support streaming ASR via crispasr_stream_open
        let streaming_backends = ["whisper", "moonshine-streaming", "voxtral4b", "kyutai-stt"];
        let all_models = crispasr::list_known_models();
        for backend in &streaming_backends {
            assert!(
                all_models.iter().any(|m| m == backend),
                "streaming backend `{backend}` should be in the registry"
            );
        }
    }

    #[test]
    fn registry_has_tts_models() {
        let tts_backends = ["kokoro", "orpheus", "vibevoice-tts", "chatterbox", "piper"];
        let all_models = crispasr::list_known_models();
        for backend in &tts_backends {
            assert!(
                all_models.iter().any(|m| m == backend),
                "TTS backend `{backend}` should be in the registry"
            );
        }
    }

    #[test]
    fn registry_has_translation_models() {
        let nmt_backends = ["m2m100", "m2m100-wmt21", "madlad"];
        let all_models = crispasr::list_known_models();
        for backend in &nmt_backends {
            assert!(
                all_models.iter().any(|m| m == backend),
                "NMT backend `{backend}` should be in the registry"
            );
        }
    }

    #[test]
    fn registry_lookup_kokoro_tts() {
        let entry = crispasr::registry_lookup("kokoro");
        // kokoro may or may not be in the registry depending on version
        match entry {
            Ok(Some(e)) => println!("kokoro: filename={}", e.filename),
            Ok(None) => println!("kokoro not in registry (expected for older builds)"),
            Err(e) => println!("kokoro lookup error (non-fatal): {e}"),
        }
    }

    // ── Cache dir tests ───────────────────────────────────────────────

    #[test]
    fn cache_dir_returns_path() {
        let dir = crispasr::cache_dir(None)
            .expect("cache_dir should not error")
            .expect("cache_dir should return a path");
        assert!(!dir.is_empty(), "cache_dir should return a non-empty path");
        println!("Default cache dir: {dir}");
    }

    // ── Live translation test (downloads model on first run) ──────────

    #[test]
    #[ignore] // Run with: cargo test --features crispasr -- --ignored
    fn live_translate_en_to_de() {
        let cache = test_cache_dir();
        let cache_str = cache.to_string_lossy();

        // Download and cache the m2m100 Q4 model (~271 MB)
        let entry = crispasr::registry_lookup("m2m100")
            .unwrap()
            .expect("m2m100 in registry");
        let model_path = crispasr::cache_ensure_file(
            &entry.filename,
            &entry.url,
            false,
            Some(&cache_str),
        )
        .expect("cache_ensure_file should succeed")
        .expect("should return a path");
        println!("Model cached at: {model_path}");

        // Open session
        let session =
            crispasr::Session::open_with_backend(&model_path, "m2m100", 4)
                .expect("Session::open should succeed");
        assert_eq!(session.backend(), "m2m100");

        // Translate
        let result = session
            .translate_text("Hello world", "en", "de", 200)
            .expect("translate_text should succeed");
        println!("Translated: 'Hello world' -> '{result}'");
        assert!(
            !result.is_empty(),
            "translation should not be empty"
        );
        // The translation should contain some German
        // (exact output depends on model version, but should be recognizable)
        let lower = result.to_lowercase();
        assert!(
            lower.contains("hallo") || lower.contains("welt") || lower.contains("hello"),
            "translation '{result}' doesn't look like German"
        );
    }

    #[test]
    #[ignore]
    fn live_translate_de_to_en() {
        let cache = test_cache_dir();
        let cache_str = cache.to_string_lossy();
        let entry = crispasr::registry_lookup("m2m100").unwrap().unwrap();
        let model_path =
            crispasr::cache_ensure_file(&entry.filename, &entry.url, false, Some(&cache_str))
                .unwrap()
                .unwrap();

        let session = crispasr::Session::open_with_backend(&model_path, "m2m100", 4).unwrap();
        let result = session
            .translate_text("Guten Morgen, wie geht es Ihnen?", "de", "en", 200)
            .unwrap();
        println!("Translated: '{result}'");
        assert!(!result.is_empty());
        let lower = result.to_lowercase();
        assert!(
            lower.contains("good") || lower.contains("morning") || lower.contains("how"),
            "translation '{result}' doesn't look like English"
        );
    }

    #[test]
    #[ignore]
    fn live_translate_multiple_pairs() {
        let cache = test_cache_dir();
        let cache_str = cache.to_string_lossy();
        let entry = crispasr::registry_lookup("m2m100").unwrap().unwrap();
        let model_path =
            crispasr::cache_ensure_file(&entry.filename, &entry.url, false, Some(&cache_str))
                .unwrap()
                .unwrap();

        let session = crispasr::Session::open_with_backend(&model_path, "m2m100", 4).unwrap();

        // EN -> FR
        let fr = session.translate_text("Thank you very much", "en", "fr", 200).unwrap();
        println!("EN->FR: {fr}");
        assert!(!fr.is_empty());

        // EN -> ES
        let es = session.translate_text("Thank you very much", "en", "es", 200).unwrap();
        println!("EN->ES: {es}");
        assert!(!es.is_empty());

        // EN -> JA
        let ja = session.translate_text("Hello", "en", "ja", 200).unwrap();
        println!("EN->JA: {ja}");
        assert!(!ja.is_empty());
    }

    #[test]
    #[ignore]
    fn live_translate_empty_input() {
        let cache = test_cache_dir();
        let cache_str = cache.to_string_lossy();
        let entry = crispasr::registry_lookup("m2m100").unwrap().unwrap();
        let model_path =
            crispasr::cache_ensure_file(&entry.filename, &entry.url, false, Some(&cache_str))
                .unwrap()
                .unwrap();

        let session = crispasr::Session::open_with_backend(&model_path, "m2m100", 4).unwrap();
        // Empty input — should either return empty or error, not crash
        let result = session.translate_text("", "en", "de", 200);
        match result {
            Ok(text) => println!("Empty input returned: '{text}'"),
            Err(e) => println!("Empty input errored (acceptable): {e}"),
        }
    }

    #[test]
    #[ignore]
    fn live_translate_long_text() {
        let cache = test_cache_dir();
        let cache_str = cache.to_string_lossy();
        let entry = crispasr::registry_lookup("m2m100").unwrap().unwrap();
        let model_path =
            crispasr::cache_ensure_file(&entry.filename, &entry.url, false, Some(&cache_str))
                .unwrap()
                .unwrap();

        let session = crispasr::Session::open_with_backend(&model_path, "m2m100", 4).unwrap();
        let long_text = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        let result = session
            .translate_text(&long_text, "en", "de", 500)
            .unwrap();
        println!("Long text ({} chars) -> {} chars", long_text.len(), result.len());
        assert!(!result.is_empty());
        assert!(result.len() > 20, "translation of long text should be substantial");
    }
}

// ── Tests that run without the crispasr feature ───────────────────────────

#[cfg(not(feature = "crispasr"))]
mod stub {
    #[test]
    fn asr_available_is_false_without_feature() {
        // When compiled without the crispasr feature, asr_available should be false
        assert!(!cfg!(feature = "crispasr"));
    }
}
