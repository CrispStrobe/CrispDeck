import { pathToFileURL } from 'node:url';

// Inventory only: never fetch subscription bodies, print identifiers or delete.
export async function inventoryLegacySubscriptions(listPage) {
  const report = { prefix: 'push-subscriptions/', objects: 0, bytes: 0, oldestUpload: null, newestUpload: null };
  const seen = new Set();
  let cursor;
  for (;;) {
    const page = await listPage({ prefix: report.prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.blobs)) throw new Error('Invalid inventory page');
    for (const blob of page.blobs) {
      if (typeof blob.pathname !== 'string' || !blob.pathname.startsWith(report.prefix) ||
          !Number.isSafeInteger(blob.size) || blob.size < 0) throw new Error('Invalid inventory metadata');
      const date = new Date(blob.uploadedAt);
      if (!Number.isFinite(date.getTime())) throw new Error('Invalid inventory date');
      const upload = date.toISOString();
      report.objects++;
      report.bytes += blob.size;
      if (!Number.isSafeInteger(report.bytes)) throw new Error('Inventory size overflow');
      if (!report.oldestUpload || upload < report.oldestUpload) report.oldestUpload = upload;
      if (!report.newestUpload || upload > report.newestUpload) report.newestUpload = upload;
    }
    if (!page.hasMore) return report;
    if (typeof page.cursor !== 'string' || !page.cursor || seen.has(page.cursor)) throw new Error('Invalid inventory cursor');
    cursor = page.cursor;
    seen.add(cursor);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Missing storage access');
    const { list } = await import('@vercel/blob');
    console.log(JSON.stringify(await inventoryLegacySubscriptions(list), null, 2));
  } catch {
    // SDK errors may include URLs or credentials; keep diagnostics private.
    console.error('Inventory failed. Check storage access privately. No records were modified.');
    process.exitCode = 1;
  }
}
