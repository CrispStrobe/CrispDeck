import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { translations } from './i18n.svelte';

const LOCALES = ['ar', 'de', 'es', 'fr', 'ja', 'pt', 'zh'];

function flat(obj: any, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === 'string') out[prefix + k] = v;
    else if (v && typeof v === 'object') flat(v, `${prefix}${k}.`, out);
  }
  return out;
}

it('dump translation gaps', async () => {
  const en = flat((translations as any).en);
  const report: Record<string, string[]> = {};
  for (const loc of LOCALES) {
    const mod = await import(`./i18n/${loc}.ts`);
    const have = flat(mod.default);
    report[loc] = Object.keys(en).filter((k) => !(k in have));
  }
  writeFileSync('/tmp/i18n/gaps.json', JSON.stringify({ en, gaps: report }, null, 0));
  for (const loc of LOCALES) {
    console.log(`  ${loc}: missing ${report[loc].length} of ${Object.keys(en).length}`);
  }
});
