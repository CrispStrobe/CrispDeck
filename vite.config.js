import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// Read version + git hash for About page
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { chunkMap } from './bench/chunk-map-plugin.js';
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
let gitHash = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '';
if (!gitHash) try { gitHash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}

/** Inject version into static/sw.js at build time */
function swVersionPlugin() {
  const swVersion = `${pkg.version}-${gitHash || Date.now()}`;
  return {
    name: 'sw-version',
    closeBundle() {
      const swPath = 'build/sw.js';
      try {
        const content = readFileSync(swPath, 'utf8');
        writeFileSync(swPath, content.replace(/__SW_VERSION__/g, swVersion));
      } catch {}
    },
  };
}

export default defineConfig({
  plugins: [
    sveltekit(),
    tailwindcss(),
    swVersionPlugin(),
    // Off unless asked for: it writes a build report, not app output.
    ...(process.env.BENCH_CHUNK_MAP ? [chunkMap()] : [])
  ],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash),
    // Origin serving CrispDeck's own /api/* functions. Empty means
    // same-origin, which is right for Vercel, the dev server and Tauri.
    // The GitHub Pages workflow sets it, because Pages has no functions.
    __API_ORIGIN__: JSON.stringify(process.env.PUBLIC_API_ORIGIN ?? ''),
  },

  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        /** @param {string} id */
        manualChunks(id) {
          // Split large vendor dependencies into separate cacheable chunks
          if (id.includes('node_modules/@atproto')) return 'vendor-atproto';
          if (id.includes('node_modules/masto')) return 'vendor-masto';
          if (id.includes('node_modules/@lucide')) return 'vendor-icons';
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },

  // Resolve the browser build of dependencies in tests. Without this, `svelte`
  // resolves to its server entry and mount() is unavailable, so a component can
  // only be tested by copying its logic into the test — which is how a third of
  // this suite ended up asserting against its own fixtures.
  resolve: { conditions: ['browser'] },

  test: {
    include: ['src/**/*.test.ts'],
    // Most of this codebase is browser code — localStorage, document, window.
    // A suite that genuinely needs plain Node can opt out per-file with a
    // `// @vitest-environment node` docblock.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    hmr: undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
