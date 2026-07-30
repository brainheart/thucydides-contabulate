// @ts-check
const { test, expect } = require('@playwright/test');

async function waitForDataLoaded(page) {
  await page.waitForFunction(() => {
    return window.__contabulateReady === true;
  }, { timeout: 15000 });
}

async function pickSampleQuery(page) {
  return 'ἀθηναῖοι';
}

async function search(page, query, { gran = 'play', ngramMode = '1', matchMode = 'exact' } = {}) {
  await page.selectOption('#gran', gran);
  await page.selectOption('#matchMode', matchMode);
  if (matchMode === 'regex') {
    await page.selectOption('#ngramMode', ngramMode);
  }
  await page.fill('#q', query);
  await page.press('#q', 'Enter');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  if (gran === 'line') {
    await expect(page.locator('#results thead')).toContainText('Segment', { timeout: 10000 });
  }
}

test.describe('Page Load', () => {
  test('loads and shows the Thucydides title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Thucydides/);
  });

  test('opens on the Book view of the single work', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    await expect(page.locator('#gran')).toHaveValue('act');
    await expect(page.locator('#results tbody tr')).toHaveCount(8);
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Book'))).toBeTruthy();
    expect(texts.some(t => t.includes('# chapters'))).toBeTruthy();
    expect(texts.some(t => t.includes('# segments'))).toBeTruthy();
    expect(texts.some(t => t.includes('# comments'))).toBeFalsy();
  });
});

test.describe('Segments Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('supports exact-term auto ngram detection and removable headers', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await page.fill('#q', `${sample} ${sample}`);
    await page.click('#addColumnBtn');
    await expect(page.locator('#results thead th')).toContainText([`"${sample} ${sample}"`]);
    await page.locator('#results thead th button.term-col-remove').click();
    await expect(page.locator('#results thead th')).not.toContainText([`"${sample} ${sample}"`]);
  });

  test('the + popover offers metrics only, without a commentators group', async ({ page }) => {
    await page.locator('#results thead th.add-column-th').click();
    const popover = page.locator('.add-column-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('.add-column-search')).toHaveAttribute('placeholder', 'Search metrics...');
    await expect(popover.locator('.add-column-group-title', { hasText: 'Commentators' })).toHaveCount(0);
    await popover.locator('.add-column-option', { hasText: '% Hapax' }).click();
    await page.keyboard.press('Escape');
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('% Hapax'))).toBeTruthy();
  });

  test('count cells drill down through books and chapters', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    // Book 1 → its chapters
    await page.locator('#results tbody tr').first().locator('td:nth-child(4) button.drill-link').click();
    await expect(page.locator('#gran')).toHaveValue('chapter');
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.001.');
    // Back un-drills
    await page.goBack();
    await expect(page.locator('#gran')).toHaveValue('act');
  });

  test('vocabulary granularities put n-grams in the rows', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await page.selectOption('#gran', 'word');
    await expect(page.locator('#results thead th[data-key="ngram"]')).toHaveCount(1);
    await expect(page.locator('#results thead th[data-key="unusualness"]')).toHaveCount(1);
    // No proper-name data in this corpus, so the toggle stays hidden
    await expect(page.locator('#vocabNamesToggle')).toBeHidden();
    await expect(page.locator('#vocabNamesUnavailable')).toBeVisible();
    await expect(page.locator('.ngram-exclude-btn')).toHaveCount(0);
    // The search box filters the Word column here
    await page.fill('#q', 'ἀθηναῖοι');
    await page.locator('#addColumnBtn').click();
    await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('matches ἀθηναῖοι');
    const words = await page.locator('#results tbody tr td:first-child').allTextContents();
    expect(words.length).toBeGreaterThan(0);
    expect(words.every(w => w.includes('ἀθηναῖοι'))).toBeTruthy();
  });

  test('supports regex mode with explicit ngram selection', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await search(page, `^${sample}$`, { gran: 'play', matchMode: 'regex', ngramMode: '1' });
    expect(await page.locator('#results tbody tr').count()).toBeGreaterThan(0);
  });

  test('segment rows render highlights', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await search(page, sample, { gran: 'line' });
    await page.locator('#segmentsTab details summary').click();
    await expect(page.locator('#results tbody td .hit').first()).toBeVisible({ timeout: 10000 });
  });

  test('granularity selector uses Segment for text rows', async ({ page }) => {
    const options = await page.locator('#gran option').evaluateAll((opts) =>
      opts.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
    );
    expect(options.some((opt) => opt.value === 'scene')).toBeFalsy();
    expect(options).toContainEqual({ value: 'line', text: 'Segment' });
  });

  test('maps legacy scene URL granularities to the Segment view', async ({ page }) => {
    const sample = await pickSampleQuery(page);
    await page.goto(`/?q=${sample}&nm=1&gran=line&mm=exact&sk=location&sd=asc&cs=1&zr=0&hl=1`);
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    await expect(page.locator('#gran')).toHaveValue('line');
    let texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Segment'))).toBeTruthy();

    await page.goto(`/?q=${sample}&nm=1&gran=scene&mm=exact&sk=location&sd=asc&cs=1&zr=0&hl=1`);
    await waitForDataLoaded(page);
    await page.waitForSelector('#results tbody tr', { timeout: 10000 });
    await expect(page.locator('#gran')).toHaveValue('line');
    texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Segment'))).toBeTruthy();
  });
});

test.describe('Segments View', () => {
  test('shows matching rows at Segment granularity', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    const sample = await pickSampleQuery(page);
    await search(page, sample, { gran: 'line' });
    const texts = await page.locator('#results thead th').allTextContents();
    expect(texts.some(t => t.includes('Book'))).toBeTruthy();
    expect(texts.some(t => t.includes('Chapter'))).toBeTruthy();
    expect(texts.some(t => t.includes('Section #'))).toBeTruthy();
    expect(texts.some(t => t.includes('# comments'))).toBeFalsy();
    await expect(page.locator('#results tbody tr').first()).toBeVisible();
  });
});

test('vocabulary scope survives switching the n-gram size', async ({ page }) => {
  await page.goto('/?gran=word&s_ft_location=%5E01%5C.Thuc%5C.003%5C.');
  await waitForDataLoaded(page);
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.003.');
  // Switching word -> bigram keeps the same scope in place
  await page.selectOption('#gran', 'bigram');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.003.');
  await page.selectOption('#gran', 'trigram');
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.003.');
  // ...and carries into the location granularities
  await page.selectOption('#gran', 'act');
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.003.');
  // Jumping coarser than the scope shows its containing row, not nothing
  await page.selectOption('#gran', 'play');
  await expect(page.locator('#results tbody tr')).toHaveCount(1);
  await expect(page.locator('#segmentsActiveFilters .active-filter-chip')).toContainText('starts with 01.Thuc.003.');
});
