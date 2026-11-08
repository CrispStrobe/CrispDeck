package com.christianstrobele.crispdeck

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.doOnAttach
import org.json.JSONTokener

class MainActivity : TauriActivity() {
  private var lightSystemBars = false
  private var surfaceColor = Color.rgb(30, 41, 59)
  private var insetContainer: FrameLayout? = null
  private var appWebView: WebView? = null
  private var surfaceRequest = 0

  override fun onCreate(savedInstanceState: Bundle?) {
    val preferences = getPreferences(MODE_PRIVATE)
    lightSystemBars = preferences.getBoolean("lightSystemBars", false)
    surfaceColor = preferences.getInt("systemBarSurfaceColor", defaultSurfaceColor())
    applySystemBars()
    super.onCreate(savedInstanceState)
  }

  override fun setContentView(view: View) {
    if (view !is WebView) {
      super.setContentView(view)
      return
    }

    // Wry installs its WebView directly with setContentView(View). Fit the
    // native viewport, rather than relying on CSS env() support in the device's
    // WebView version. This protects every fixed surface, including dialogs.
    appWebView = view
    val container = FrameLayout(this)
    insetContainer = container
    container.setBackgroundColor(surfaceColor)
    container.addView(view, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    ))
    val handledTypes = WindowInsetsCompat.Type.systemBars() or
      WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(container) { root, windowInsets ->
      // getInsets combines overlapping types with their maximum, not their
      // sum: an open keyboard already includes the navigation bar beneath it.
      // Keep adjustResize in the manifest for AndroidX's older-Android IME path.
      val safe = windowInsets.getInsets(handledTypes)
      root.setPadding(safe.left, safe.top, safe.right, safe.bottom)

      // Forward an update with the handled dimensions zeroed. CONSUMED would
      // suppress later WebView updates and can leave stale keyboard padding;
      // forwarding the originals would apply the same safe area twice in CSS.
      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(handledTypes, Insets.NONE)
        .build()
    }
    container.doOnAttach { ViewCompat.requestApplyInsets(it) }
    super.setContentView(container)
    syncSurfaceColor()
  }

  // Called on the WebView's UI thread through Tauri's native handle. Keep the
  // JNI entry point when release builds shrink/obfuscate the Android classes.
  @Keep
  fun setSystemBarTheme(light: Boolean) {
    if (lightSystemBars != light) {
      surfaceColor = if (light) Color.WHITE else Color.rgb(30, 41, 59)
    }
    lightSystemBars = light
    getPreferences(MODE_PRIVATE).edit().putBoolean("lightSystemBars", light).apply()
    applySystemBars()
    syncSurfaceColor()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applySystemBars()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) insetContainer?.let { ViewCompat.requestApplyInsets(it) }
  }

  override fun onDestroy() {
    surfaceRequest++
    appWebView = null
    insetContainer = null
    super.onDestroy()
  }

  private fun defaultSurfaceColor(): Int =
    if (lightSystemBars) Color.WHITE else Color.rgb(30, 41, 59)

  private fun paintSurface() {
    insetContainer?.setBackgroundColor(surfaceColor)
    window.setBackgroundDrawable(ColorDrawable(surfaceColor))
  }

  private fun syncSurfaceColor() {
    val webView = appWebView ?: return
    val request = ++surfaceRequest
    // The existing JNI theme contract is a light/dark boolean. Read the shared
    // CSS surface token after the web theme changes so OLED remains OLED too.
    webView.evaluateJavascript(
      "document.documentElement ? getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim() : ''",
    ) { encoded ->
      if (request != surfaceRequest || isDestroyed || appWebView !== webView) return@evaluateJavascript
      val color = runCatching {
        val value = JSONTokener(encoded).nextValue() as? String ?: return@runCatching null
        Color.parseColor(value)
      }.getOrNull() ?: return@evaluateJavascript
      surfaceColor = color
      paintSurface()
      getPreferences(MODE_PRIVATE).edit().putInt("systemBarSurfaceColor", color).apply()
    }
  }

  private fun applySystemBars() {
    val style = if (lightSystemBars) {
      // Older Android navigation bars cannot draw dark icons; retain a dark
      // fallback scrim there while modern bars stay transparent.
      SystemBarStyle.light(Color.TRANSPARENT, Color.rgb(30, 41, 59))
    } else {
      SystemBarStyle.dark(Color.TRANSPARENT)
    }
    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    paintSurface()
    insetContainer?.let { ViewCompat.requestApplyInsets(it) }
  }
}
