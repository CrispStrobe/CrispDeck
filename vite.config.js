import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// Read version + git hash for About page
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
let gitHash = '';
try { gitHash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}

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

export default defineConfig(async () => ({
  plugins: [sveltekit(), tailwindcss(), swVersionPlugin()],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash),
  },

  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
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

  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
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
}));
