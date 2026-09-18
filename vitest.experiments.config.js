/**
 * Config for the one-off measurement scripts under scripts/experiments/.
 * They are deliberately outside the main suite (vite.config.js only collects
 * src/**\/*.test.ts) because they take minutes and answer design questions
 * rather than guarding behaviour.
 *
 *   npx vitest run --config vitest.experiments.config.js
 */
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { $lib: path.resolve(root, 'src/lib') } },
  test: { include: ['scripts/experiments/*.test.ts'], environment: 'node' },
});
