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
        /**
         * @param {string} id
         * @param {{ getModuleInfo: (id: string) => { importers?: readonly string[] } | null }} ctx
         */
        manualChunks(id, { getModuleInfo }) {
          // Split large vendor dependencies into separate cacheable chunks
          if (id.includes('node_modules/@atproto')) return 'vendor-atproto';
          if (id.includes('node_modules/masto')) return 'vendor-masto';

          // Icons are one module each and are imported by deep path, so an
          // icon's importers are the components that use it. Letting Rollup
          // place them freely scattered 112 modules across 74 chunks, which
          // cost more in per-chunk overhead and requests than the icons
          // weigh. Two groups instead: what the shell paints with, and the
          // rest, which no longer rides into the entry behind it.
          if (/node_modules[/\\]@lucide[/\\]svelte[/\\]/.test(id)) {
            const isIcon = /[/\\]icons[/\\][\w-]+\.js$/.test(id);
            if (!isIcon) return 'vendor-icons-shell'; // shared base component
            const importers = getModuleInfo(id)?.importers ?? [];
            const inShell = importers.some((i) => /routes[/\\]\+layout\.svelte/.test(i));
            return inShell ? 'vendor-icons-shell' : 'vendor-icons-route';
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },

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
