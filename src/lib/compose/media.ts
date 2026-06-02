/** Validate a media file for upload */
export function validateMediaFile(file: File): string | null {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Unsupported file type: ${file.type}. Use JPEG, PNG, GIF, or WebP.`;
  }
  if (file.size > MAX_SIZE) {
    return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max 10MB.`;
  }
  return null;
}

/** Create a preview URL for a file */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/** Revoke a preview URL to free memory */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
