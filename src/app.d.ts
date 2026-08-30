// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /**
   * Build-time constants substituted by Vite's `define` (see vite.config.js).
   * Declared here rather than per-component: `declare const` is an ambient
   * statement and is not valid inside a Svelte instance `<script>` block.
   */
  const __VERSION__: string;
  const __GIT_HASH__: string;
}

export {};
