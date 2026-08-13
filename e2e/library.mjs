/**
 * End-to-end walk through the book workflow, driven in a real browser:
 * import an EPUB → classify it → read it → look a word up → save an excerpt
 * and a word → edit, search and export the notebooks.
 *
 *   READIT_SAMPLE_EPUB=/path/to/book.epub npm run test:e2e
 *
 * Requires the server to be running (npm start).
 */
import { BASE, openBrowser, makeStep, finish } from './helpers.mjs';

const EPUB = process.env.READIT_SAMPLE_EPUB;
if (!EPUB) {
  console.log('Skipping: set READIT_SAMPLE_EPUB to an .epub file to run this suite.');
  process.exit(0);
}

const { browser, page, errors } = await openBrowser();
const { step } = makeStep();

await step('load library', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Readit');
});

await step('upload the EPUB', async () => {
  await page.click('text=+ Add to library');
  await page.setInputFiles('input[type=file]', EPUB);
  await page.click('button:has-text("Import")');
  await page.waitForSelector('text=A Feast of Vultures', { timeout: 30000 });
});

await step('facets show the book\'s classification', async () => {
  const body = await page.textContent('aside');
  for (const want of ['Book', 'English', 'Josy Joseph', 'HarperCollins India']) {
    if (!body.includes(want)) throw new Error(`facet sidebar missing "${want}"`);
  }
});

await step('filter by author', async () => {
  await page.click('button:has-text("Josy Joseph")');
  await page.waitForSelector('text=1 item');
});
await page.click('text=Clear all');

await step('open item detail', async () => {
  await page.click('a:has-text("A Feast of Vultures")');
  await page.waitForSelector('h1:has-text("A Feast of Vultures")');
  const text = await page.textContent('dl');
  for (const want of ['HarperCollins India', 'English', '2016']) {
    if (!text.includes(want)) throw new Error(`detail missing ${want}`);
  }
});

await step('search inside the book', async () => {
  await page.fill('input[placeholder="Keyword…"]', 'corruption');
  await page.waitForSelector('mark', { timeout: 10000 });
});

const itemUrl = page.url();
const itemId = Number(itemUrl.split('/').pop());

await step('open the reader and render the EPUB', async () => {
  await page.goto(`${BASE}/read/${itemId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('iframe', { timeout: 30000 });
  await page.waitForTimeout(2500);
});

await step('table of contents loads', async () => {
  await page.click('button:has-text("Contents")');
  await page.waitForSelector('nav h2:has-text("Contents")');
  const items = await page.locator('nav button').count();
  if (items < 5) throw new Error(`expected a real TOC, got ${items} entries`);
});

await step('navigate to a chapter with prose', async () => {
  await page.click('nav button:has-text("Arms and the Middleman")');
  await page.waitForTimeout(2500);
  await page.click('button:has-text("Contents")'); // close panel
  // Closing the panel resizes the rendition, which re-renders the iframe.
  await page.waitForTimeout(2500);
});

// Select a word inside the epub.js iframe and confirm the popup appears.
await step('selecting a word opens the dictionary popup', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw new Error('no epub iframe');
  const found = await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.search(/\bcorruption\b/i);
      if (idx >= 0 && node.parentElement?.offsetParent !== null) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'corruption'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return node.textContent.slice(idx, idx + 10);
      }
    }
    return null;
  });
  if (!found) throw new Error('could not find the word "corruption" on screen');
  await page.waitForSelector('[role=dialog][aria-label=Selection]', { timeout: 10000 });
  await page.waitForSelector('text=any of various large diurnal|text=wrongdoing|text=/definition/', { timeout: 5000 }).catch(() => {});
});

await step('popup shows a real definition', async () => {
  const popup = await page.textContent('[role=dialog][aria-label=Selection]');
  if (!/wordnet/i.test(popup)) throw new Error(`popup had no dictionary result: ${popup.slice(0, 200)}`);
  console.log('\n    popup text:', popup.replace(/\s+/g, ' ').slice(0, 180));
  process.stdout.write('  ');
});

await step('save the word to the word list', async () => {
  await page.click('button:has-text("Save word")');
  // Either message is correct: on a fresh library the word is new, on a re-run
  // it is already filed under today's date.
  await page.waitForSelector('text=/Saved to the word list|already in today/i', { timeout: 10000 });
});

await step('saving the same word twice in a day does not duplicate it', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.search(/\bcorruption\b/i);
      if (idx >= 0 && node.parentElement?.offsetParent !== null) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + 'corruption'.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
  });
  await page.waitForSelector('[role=dialog][aria-label=Selection]', { timeout: 10000 });
  await page.click('button:has-text("Save word")');
  await page.waitForSelector('text=/already in today/i', { timeout: 10000 });
});

await step('select a passage and add it to reading notes', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((el) => el.innerText.trim().length > 200);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForSelector('[role=dialog][aria-label=Selection]', { timeout: 10000 });
  await page.click('button:has-text("Add to notes")');
  await page.waitForSelector('text=Added to reading notes', { timeout: 10000 });
});

await step('reading notes document holds the excerpt', async () => {
  await page.click('a[title="Reading notes"]');
  await page.waitForSelector('h1:has-text("Reading notes")');
  const title = await page.textContent('h1');
  if (!title.includes('Josy Joseph') || !title.includes('HarperCollins')) {
    throw new Error(`document title lacks the book particulars: ${title}`);
  }
  await page.waitForSelector('article');
});

await step('excerpt is editable and edits persist', async () => {
  const body = page.locator('article [contenteditable]').first();
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [my annotation]');
  await page.click('h1');
  await page.waitForSelector('text=Saved.', { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle' });
  const text = await page.textContent('article [contenteditable]');
  if (!text.includes('[my annotation]')) throw new Error('edit did not persist');
});

await step('keyword search inside the document', async () => {
  await page.fill('input[placeholder="Keyword…"]', 'annotation');
  await page.waitForSelector('text=/1 matching entr/', { timeout: 10000 });
  await page.fill('input[placeholder="Keyword…"]', 'zzzznotpresent');
  await page.waitForSelector('text=Nothing matches', { timeout: 10000 });
  await page.click('button:has-text("Clear")');
});

await step('date search inside the document', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('input[type=date] >> nth=0', today);
  await page.waitForSelector('article', { timeout: 10000 });
  await page.fill('input[type=date] >> nth=0', '2000-01-01');
  await page.fill('input[type=date] >> nth=1', '2000-01-02');
  await page.waitForSelector('text=Nothing matches', { timeout: 10000 });
});

await step('word list has the saved word with meanings', async () => {
  await page.goto(`${BASE}/item/${itemId}`, { waitUntil: 'networkidle' });
  await page.click('a:has-text("Word list")');
  await page.waitForSelector('h1:has-text("Word list")');
  const text = await page.textContent('article');
  if (!/corruption/i.test(text)) throw new Error('word missing');
  if (!/wordnet/i.test(text)) throw new Error('meanings were not captured with the word');

  // The word list pages by reading date, so a library used across several days
  // has several pages. Find today's rather than assuming there is only one.
  const today = new Date().toISOString().slice(0, 10);
  const pages = await page.locator('section').allTextContents();
  const todaysPage = pages.find((p) => p.includes(today));
  if (!todaysPage) {
    throw new Error(`no word-list page for today (${today}); pages: ${pages.map((p) => p.slice(0, 24)).join(' | ')}`);
  }
  if (!/corruption/i.test(todaysPage)) {
    throw new Error("today's page does not hold the word that was just saved");
  }
});

await step('markdown export works', async () => {
  const res = await page.request.get(`${BASE}/api/documents/1/export`);
  const body = await res.text();
  if (!body.startsWith('# Reading notes —')) throw new Error(`bad export: ${body.slice(0, 80)}`);
});

await step('dictionary page lists sources and looks words up', async () => {
  await page.goto(`${BASE}/dictionary`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=WordNet (English)');
  await page.fill('input[placeholder*="Malayalam"]', 'ജനാധിപത്യത്തിന്റെ');
  await page.waitForSelector('text=democracy', { timeout: 10000 });
  await page.waitForSelector('text=root form');
});

await browser.close();
finish(errors, 'Book workflow');
