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

/** @type {Array<{icon: string, inShell: boolean, importers: number}>} */
const iconDecisions = [];

/** Writes what manualChunks decided, so a no-op is distinguishable from a no-run. */
function iconDecisionReport() {
  return {
    name: 'bench-icon-decisions',
    apply: 'build',
    closeBundle() {
      if (!process.env.BENCH_CHUNK_MAP) return;
      const shell = iconDecisions.filter((d) => d.inShell).length;
      writeFileSync('icon-split.json', JSON.stringify({
        ran: iconDecisions.length > 0,
        icons: iconDecisions.length,
        shell,
        route: iconDecisions.length - shell,
        sample: iconDecisions.slice(0, 8)
      }, null, 2));
    }
  };
}

export default defineConfig({
  plugins: [
    sveltekit(),
    tailwindcss(),
    swVersionPlugin(),
    // Off unless asked for: it writes a build report, not app output.
    ...(process.env.BENCH_CHUNK_MAP ? [chunkMap(), iconDecisionReport()] : [])
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

          // Icons are one module per icon, and the old rule put all of them in
          // a single chunk. The root layout's navigation needs 23 of them, so
          // that one chunk was pulled into the entry -- and with it the other
          // 89 icons, measured, that only individual routes use. Every visitor
          // downloaded the icons for pages they had not opened.
          //
          // Split by who imports them instead of by a hardcoded list of names:
          // a list would drift the moment someone adds an icon to the layout,
          // and it would drift silently, because the icon would still render.
          if (/node_modules[/\\]@lucide[/\\]svelte[/\\]/.test(id)) {
            const isIcon = /[/\\]icons[/\\][\w-]+\.js$/.test(id);
            if (!isIcon) return 'vendor-icons-shell'; // shared base component
            const importers = getModuleInfo(id)?.importers ?? [];
            const inShell = importers.some((i) => /routes[/\\]\+layout\.svelte/.test(i));
            // Diagnostic: SvelteKit emits chunks as [hash].js with no [name],
            // so a manualChunks name never reaches a filename and there is no
            // way to tell from the output whether this function ran at all.
            if (process.env.BENCH_CHUNK_MAP) {
              iconDecisions.push({ icon: id.replace(/^.*[/\\]/, ''), inShell, importers: importers.length });
            }
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
