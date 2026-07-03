/**
 * Push notification scaffold.
 *
 * Desktop + Mobile (Tauri): uses tauri-plugin-notification for local notifications.
 * Web: uses the Notifications API (requires user permission).
 *
 * This module handles permission requests and sending notifications.
 * The actual polling for new posts/messages is done by the feed page's
 * existing 60-second interval — this module just dispatches the notification.
 */

export type NotificationPermission = 'granted' | 'denied' | 'default';

/** Check if notifications are supported */
export function isSupported(): boolean {
  return typeof Notification !== 'undefined' || typeof (globalThis as any).__TAURI_INTERNALS__ !== 'undefined';
}

/** Request notification permission. Returns the permission state. */
export async function requestPermission(): Promise<NotificationPermission> {
  // Tauri path
  const w = globalThis as any;
  if (w.__TAURI_INTERNALS__) {
    try {
      const { isPermissionGranted, requestPermission: tauriRequest } =
        await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await tauriRequest();
        granted = perm === 'granted';
      }
      return granted ? 'granted' : 'denied';
    } catch {
      // Plugin not installed — fall through to web
    }
  }

  // Web path
  if (typeof Notification !== 'undefined') {
    const result = await Notification.requestPermission();
    return result as NotificationPermission;
  }

  return 'denied';
}

/** Check current permission without prompting */
export async function getPermission(): Promise<NotificationPermission> {
  const w = globalThis as any;
  if (w.__TAURI_INTERNALS__) {
    try {
      const { isPermissionGranted } = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
      return (await isPermissionGranted()) ? 'granted' : 'default';
    } catch {}
  }

  if (typeof Notification !== 'undefined') {
    return Notification.permission as NotificationPermission;
  }

  return 'denied';
}

/** Send a notification */
export async function notify(title: string, body: string, icon?: string): Promise<void> {
  const w = globalThis as any;
  if (w.__TAURI_INTERNALS__) {
    try {
      const { sendNotification } = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
      sendNotification({ title, body });
      return;
    } catch {}
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, icon });
  }
}

/** Convenience: notify about new posts */
export async function notifyNewPosts(count: number, platform?: string): Promise<void> {
  const platformLabel = platform ? ` on ${platform}` : '';
  await notify(
    'CrispDeck',
    `${count} new post${count > 1 ? 's' : ''}${platformLabel}`,
  );
}

/** Convenience: notify about new messages */
export async function notifyNewMessage(from: string): Promise<void> {
  await notify('New Message', `From ${from}`);
}

// --- Web Push (VAPID) ---

/**
 * Subscribe to web push notifications.
 * Returns the PushSubscription JSON to send to the server.
 */
export async function subscribeWebPush(vapidPublicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) return null;

  const registration = await navigator.serviceWorker.ready;

  // Check existing subscription
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) return subscription.toJSON();

  // Create new subscription
  const convertedKey = urlBase64ToUint8Array(vapidPublicKey);
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedKey,
  });

  return subscription.toJSON();
}

/**
 * Unsubscribe from web push notifications.
 */
export async function unsubscribeWebPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;
  return subscription.unsubscribe();
}

/**
 * Get current push subscription status.
 */
export async function getPushSubscription(): Promise<PushSubscriptionJSON | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.toJSON() ?? null;
}

/** Convert VAPID public key from base64 to Uint8Array */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}
