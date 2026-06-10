/**
 * Vercel serverless function: Threads deauthorize/delete webhook.
 *
 * Meta requires Uninstall and Delete callback URLs to be set.
 * This endpoint acknowledges the request — actual credential cleanup
 * happens client-side (localStorage/IndexedDB are per-browser).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Meta sends POST with signed_request body on deauth/delete
  // Acknowledge receipt
  return res.status(200).json({ success: true });
}
