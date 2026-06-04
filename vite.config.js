import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

// Read version from package.json for the About page
import { readFileSync } from "fs";
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default defineConfig(async () => ({
  plugins: [sveltekit(), tailwindcss()],
  define: {
    __VERSION__: JSON.stringify(pkg.version),
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
