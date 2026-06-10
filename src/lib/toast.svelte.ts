/** Global toast notification store (Svelte 5 runes) */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

let nextId = 0;
let toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
  return toasts;
}

export function addToast(type: ToastType, message: string, duration = 4000): number {
  const id = nextId++;
  toasts = [...toasts, { id, type, message, duration }];
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id);
}

// Convenience helpers
export const toast = {
  success: (msg: string, duration?: number) => addToast('success', msg, duration),
  error: (msg: string, duration?: number) => addToast('error', msg, duration ?? 6000),
  info: (msg: string, duration?: number) => addToast('info', msg, duration),
  warning: (msg: string, duration?: number) => addToast('warning', msg, duration ?? 5000),
};
