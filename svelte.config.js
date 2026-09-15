import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * BASE_PATH is empty for the Vercel deployment, which is served at the root of
 * its own origin. GitHub Pages serves a project site under `/<repo>/`, so that
 * build sets BASE_PATH=/CrispDeck and every internal link has to be prefixed
 * with it. SvelteKit does not rewrite author-written `href="/feed"` — links go
 * through `base` from `$app/paths`, which is '' on Vercel and changes nothing
 * there.
 */
const base = process.env.BASE_PATH ?? "";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    runes: true,
  },
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    paths: { base },
  },
};

export default config;
