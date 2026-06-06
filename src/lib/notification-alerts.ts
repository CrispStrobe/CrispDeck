/**
 * Notification sounds + desktop alerts.
 * Plays a sound and/or shows a system notification when new mentions/DMs arrive.
 * Configurable via settings toggle.
 */

const SETTINGS_KEY = 'crispdeck-notification-alerts';

export interface AlertSettings {
  soundEnabled: boolean;
  desktopEnabled: boolean;
  soundVolume: number; // 0-1
}

const DEFAULTS: AlertSettings = {
  soundEnabled: false,
  desktopEnabled: false,
  soundVolume: 0.5,
};

export function getAlertSettings(): AlertSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(raw) }; } catch { return { ...DEFAULTS }; }
}

export function setAlertSettings(settings: Partial<AlertSettings>): void {
  const current = getAlertSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
}

/**
 * Play a notification sound (short beep using Web Audio API).
 */
export function playNotificationSound(volume = 0.5): void {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {}
}

/**
 * Show a desktop notification (requires permission).
 */
export function showDesktopAlert(title: string, body: string, icon?: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon, tag: 'crispdeck-alert' });
  } catch {}
}

/**
 * Trigger alerts based on settings.
 */
export function triggerAlert(title: string, body: string, icon?: string): void {
  const settings = getAlertSettings();
  if (settings.soundEnabled) playNotificationSound(settings.soundVolume);
  if (settings.desktopEnabled) showDesktopAlert(title, body, icon);
}
