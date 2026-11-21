import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryLegacySubscriptions } from './legacy-storage.mjs';

test('empty storage yields a completed zero-object inventory', async () => {
  const report = await inventoryLegacySubscriptions(async options => {
    assert.deepEqual(options, { prefix: 'push-subscriptions/', limit: 1000 });
    return { blobs: [], hasMore: false };
  });
  assert.equal(report.objects, 0);
  assert.equal(report.oldestUpload, null);
});

test('pagination counts metadata without returning subscription names or URLs', async () => {
  let calls = 0;
  const report = await inventoryLegacySubscriptions(async options => {
    calls++;
    assert.equal(options.prefix, 'push-subscriptions/');
    if (calls === 2) assert.equal(options.cursor, 'private-cursor');
    return { blobs: [{ pathname: 'push-subscriptions/private-user.json', url: 'https://secret.example/object',
      size: 10, uploadedAt: calls === 1 ? '2026-11-01' : '2026-10-01' }], hasMore: calls === 1, cursor: 'private-cursor' };
  });
  assert.equal(calls, 2);
  assert.equal(report.objects, 2);
  assert.equal(report.bytes, 20);
  assert.equal(report.oldestUpload, '2026-10-01T00:00:00.000Z');
  assert.equal(report.newestUpload, '2026-11-01T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(report), /private-user|secret\.example|private-cursor/);
});

test('a repeated cursor fails instead of looping or claiming completeness', async () => {
  await assert.rejects(inventoryLegacySubscriptions(async () => ({ blobs: [], hasMore: true, cursor: 'same' })), /cursor/);
});

test('a missing completion flag cannot masquerade as a complete empty inventory', async () => {
  await assert.rejects(inventoryLegacySubscriptions(async () => ({ blobs: [] })), /page/);
});

test('unexpected prefixes and malformed metadata fail closed', async () => {
  for (const blob of [
    { pathname: 'other/private.json', size: 1, uploadedAt: '2026-11-01' },
    { pathname: 'push-subscriptions/private.json', size: -1, uploadedAt: '2026-11-01' },
    { pathname: 'push-subscriptions/private.json', size: 1, uploadedAt: 'bad-date' },
    { pathname: 'push-subscriptions/private.json', size: 1, uploadedAt: null },
  ]) await assert.rejects(inventoryLegacySubscriptions(async () => ({ blobs: [blob], hasMore: false })));
});
