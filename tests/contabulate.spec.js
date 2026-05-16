const { test, expect } = require('@playwright/test');

test('Thucydides contabulate defaults to books sorted by location', async ({ page }) => {
  await page.goto('/docs/');
  await page.waitForFunction(() => window.__contabulateReady === true);

  await expect(page).toHaveTitle(/Thucydides/);
  await expect(page.locator('h1')).toContainText('Thucydides');
  await expect(page.locator('#gran')).toHaveValue('act');
  await expect(page.locator('#results thead')).toContainText('Book');
  await expect(page.locator('#results tbody tr').first()).toContainText('Βιβλίον α');
});

test('chapter granularity sits between book and segment', async ({ page }) => {
  await page.goto('/docs/');
  await page.waitForFunction(() => window.__contabulateReady === true);

  await page.locator('#gran').selectOption('chapter');
  await expect(page.locator('#results thead')).toContainText('Chapter');
  await expect(page.locator('#results tbody tr').first()).toContainText('Βιβλίον α');

  await page.locator('#q').fill('πόλεμον');
  await page.locator('#addColumnBtn').click();
  await expect(page.locator('#results thead')).toContainText('πόλεμον');
});

test('segment view shows segment text without a search term', async ({ page }) => {
  await page.goto('/docs/');
  await page.waitForFunction(() => window.__contabulateReady === true);

  await page.locator('#gran').selectOption('line');
  await expect(page.locator('#results thead')).toContainText('Section');
  await expect(page.locator('#results thead')).toContainText('Segment');
  await expect(page.locator('#results tbody tr').first()).toContainText('Θουκυδίδης Ἀθηναῖος');
});
