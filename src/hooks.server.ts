import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Content Security Policy — strict but allows required external resources
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    // Scripts: self + inline for Svelte hydration
    "script-src 'self' 'unsafe-inline'",
    // Styles: self + inline for Tailwind/Svelte
    "style-src 'self' 'unsafe-inline'",
    // Images: self + Bluesky CDN + Mastodon instances + Threads CDN + data URIs
    "img-src 'self' data: blob: https://*.bsky.social https://cdn.bsky.app https://*.cdninstagram.com https://*.fbcdn.net https://*.mstdn.social https://*.mastodon.social https://*.hachyderm.io https://*.fosstodon.org https://*",
    // Connect: APIs for all 3 networks + translation services
    "connect-src 'self' https://*.bsky.social https://*.bsky.network https://bsky.social https://plc.directory https://*.mastodon.social https://*.mstdn.social https://*.hachyderm.io https://*.fosstodon.org https://graph.threads.net https://api.tenor.com https://*",
    // Fonts
    "font-src 'self'",
    // Media: same as images
    "media-src 'self' blob: https://*",
    // Frames: none
    "frame-src 'none'",
    // Objects: none
    "object-src 'none'",
    // Base URI
    "base-uri 'self'",
    // Form actions
    "form-action 'self'",
    // Frame ancestors
    "frame-ancestors 'none'",
  ].join('; '));

  // Additional security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');

  return response;
};
