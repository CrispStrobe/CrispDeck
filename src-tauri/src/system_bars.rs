/// Match Android's system icons to the app theme, independently of OS theme.
#[tauri::command]
pub async fn set_system_bar_theme(window: tauri::WebviewWindow, light: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .with_webview(move |webview| {
                webview.jni_handle().exec(move |env, activity, _| {
                    let result = env
                        .call_method(activity, "setSystemBarTheme", "(Z)V", &[light.into()])
                        .map(|_| ())
                        .map_err(|error| format!("Android system bar theme: {error}"));
                    if result.is_err() {
                        // Do not leave a JNI exception pending on the UI thread.
                        let _ = env.exception_clear();
                    }
                    let _ = sender.send(result);
                });
            })
            .map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "Android system bar theme timed out".to_string())?
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (window, light);
        Ok(())
    }
}
