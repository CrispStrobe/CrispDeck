import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// Read version + git hash for About page
import { readFileSync } from "fs";
import { execSync } from "child_process";
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
let gitHash = '';
try { gitHash = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}

export default defineConfig(async () => ({
  plugins: [sveltekit(), tailwindcss()],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash),
  },

  build: {
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
