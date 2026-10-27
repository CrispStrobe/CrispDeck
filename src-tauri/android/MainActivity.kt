package com.christianstrobele.crispdeck

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep

class MainActivity : TauriActivity() {
  private var lightSystemBars = false

  override fun onCreate(savedInstanceState: Bundle?) {
    lightSystemBars = getPreferences(MODE_PRIVATE).getBoolean("lightSystemBars", false)
    applySystemBars()
    super.onCreate(savedInstanceState)
  }

  // Called on the WebView's UI thread through Tauri's native handle. Keep the
  // JNI entry point when release builds shrink/obfuscate the Android classes.
  @Keep
  fun setSystemBarTheme(light: Boolean) {
    lightSystemBars = light
    getPreferences(MODE_PRIVATE).edit().putBoolean("lightSystemBars", light).apply()
    applySystemBars()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applySystemBars()
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
  }
}
