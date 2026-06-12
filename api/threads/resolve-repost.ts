/**
 * Vercel serverless function: Resolve Threads repost permalink to original post.
 *
 * REPOST_FACADE posts don't expose reposted_post content via the API.
 * But the permalink redirects (301) to the original post URL.
 * This endpoint follows the redirect and returns the original author + shortcode.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const permalink = req.query.url as string;
  if (!permalink) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    // Follow redirect without actually loading the page
    const resp = await fetch(permalink, { method: 'HEAD', redirect: 'manual' });
    const location = resp.headers.get('location');

    if (!location) {
      return res.status(200).json({ resolved: false, original_url: permalink });
    }

    // Parse: https://www.threads.com/@username/post/SHORTCODE
    const match = location.match(/threads\.com\/@([^/]+)\/post\/([^/?#]+)/);
    if (!match) {
      return res.status(200).json({ resolved: false, original_url: location });
    }

    return res.status(200).json({
      resolved: true,
      original_url: location,
      original_author: match[1],
      original_shortcode: match[2],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
