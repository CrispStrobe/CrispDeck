import { describe, expect, it } from 'vitest';
import { settingsText } from './settings-copy';

describe('settings translations', () => {
  it.each(['en', 'de', 'fr', 'es', 'pt', 'ja', 'zh', 'ar'])('preserves the dynamic values in %s', language => {
    const copy = settingsText(language);
    for (const key of ['fontSizeValue', 'lineSpacingValue', 'maxWidthValue'] as const) expect(copy[key]).toContain('{value}');
    for (const key of ['feedCacheSizeValue', 'debugLogHint', 'showLogCount'] as const) expect(copy[key]).toContain('{count}');
    expect(copy.localStorageSize).toContain('{size}');
    expect(copy.indexedDbSize).toContain('{size}');
  });
});
