import { test, expect } from '@playwright/test';

test('German settings labels include values and diagnostic controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('crispdeck-language', 'de'));
  await page.goto('/settings?tab=appearance');
  await expect(page.locator('label[for="font-size"]')).toContainText('Schriftgröße:');
  await expect(page.locator('label[for="line-spacing"]')).toContainText('Zeilenabstand:');
  await expect(page.locator('label[for="content-width"]')).toContainText('Maximale Breite:');
  await page.goto('/settings?tab=content');
  await expect(page.locator('label[for="feed-cache-size"]')).toContainText('Beiträge');
  await page.goto('/settings?tab=compose');
  await page.getByRole('button', { name: 'Lingva', exact: true }).click();
  await expect(page.getByText('Kostenloser Google-Translate-Proxy', { exact: false })).toBeVisible();
  await expect(page.getByText('Wird für die Erstellung von Bildbeschreibungen verwendet.', { exact: false })).toBeVisible();
  await page.goto('/settings?tab=advanced');
  await expect(page.getByText('Cache und Speicher', { exact: true })).toBeVisible();
  await expect(page.getByText('Aktuelle Fehler und Warnungen', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Protokoll anzeigen/ })).toBeVisible();
  await expect(page.getByText('Die Modellverwaltung ist nur in der Desktop-App verfügbar.', { exact: false })).toBeVisible();
});
