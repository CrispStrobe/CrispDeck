const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

/** Validate a media file for upload */
export function validateMediaFile(file: File): string | null {
  const isImage = IMAGE_TYPES.includes(file.type);
  const isVideo = VIDEO_TYPES.includes(file.type);

  if (!isImage && !isVideo) {
    return `Unsupported file type: ${file.type}. Use JPEG, PNG, GIF, WebP, MP4, WebM, or MOV.`;
  }
  if (isImage && file.size > MAX_IMAGE_SIZE) {
    return `Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max 10MB.`;
  }
  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    return `Video too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max 100MB.`;
  }
  return null;
}

/** Check if a file is a video */
export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.includes(file.type);
}

/** Create a preview URL for a file */
export function createPreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

/** Revoke a preview URL to free memory */
export function revokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url);
}
