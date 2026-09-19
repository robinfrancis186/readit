import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { BASE, openBrowser, makeStep, finish } from './helpers.mjs';
const { browser, page, errors } = await openBrowser();
const { step } = makeStep();
let itemId;
async function poll(fn) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)); }
  throw new Error('Timed out waiting for saved server state');
}
try {
  await step('open library and sign in when required', async () => {
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('input[aria-label="Search the library"],input[type=password]'));
    if (await page.locator('input[type=password]').isVisible()) {
      assert.ok(process.env.READIT_PASSWORD, 'Set READIT_PASSWORD for a protected deployment');
      await page.getByLabel('Password').fill(process.env.READIT_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await page.getByLabel('Search the library').waitFor();
  });
  await step('import original EPUB through the browser', async () => {
    await page.getByRole('button', {name: /Add to library/}).click();
    await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/reading-garden.epub', import.meta.url)));
    await page.getByRole('button', {name: /^Import/}).click();
    await page.getByRole('link').filter({hasText:'The Reading Garden'}).first().waitFor({timeout:120000});
    await page.getByRole('link').filter({hasText:'The Reading Garden'}).first().click();
    await page.locator('h1').filter({hasText:'The Reading Garden'}).waitFor();
    itemId=Number(page.url().split('/').pop());
  });
  await step('search navigates to the matching EPUB chapter', async () => {
    await page.getByPlaceholder('Keyword…').fill('Discovery');
    const link=page.getByRole('link').filter({has:page.locator('mark')}).first();
    await link.click();
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.textContent.includes('Discovery')),null,{timeout:30000});
  });
  await step('reader saves its position while open', async () => {
    await poll(async () => {
      const d=await (await page.request.get(`${BASE}/api/library/${itemId}`)).json();
      return Boolean(d.item.reading_locator) && d.item.reading_progress>0;
    });
  });
  let entry, doc;
  await step('save, edit, search, and export a notebook', async () => {
    const detail=await (await page.request.get(`${BASE}/api/library/${itemId}`)).json();
    doc=detail.documents.find(d=>d.kind==='excerpt').id;
    const res=await page.request.post(`${BASE}/api/documents/${doc}/entries`,{data:{text:'An original saved passage.',sourceLocator:detail.item.reading_locator,sourceLabel:'The Open Library'}});
    assert.equal(res.status(),201);
    entry=(await res.json()).entry.id;
    await page.goto(`${BASE}/document/${doc}`);
    const editor=page.getByRole('textbox',{name:'Edit excerpt'}).last();
    await editor.fill('An edited original passage.');
    await page.locator('h1').click();
    await poll(async () => {
      const d=await (await page.request.get(`${BASE}/api/documents/${doc}`)).json();
      return d.entries.find(e=>e.id===entry)?.content_text==='An edited original passage.';
    });
    await page.getByPlaceholder('Keyword…').fill('edited');
    await page.getByText(/matching entr/).waitFor();
    const exported=await page.request.get(`${BASE}/api/documents/${doc}/export`);
    assert.ok((await exported.text()).includes('An edited original passage.'));
    await page.getByRole('link',{name:'The Open Library',exact:true}).last().click();
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.contentDocument?.body?.textContent.includes('Discovery')));
  });
  await step('mobile library and dictionary fit the viewport', async () => {
    await page.setViewportSize({width:390,height:844});
    await page.goto(BASE);
    await page.getByLabel('Search the library').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Filters',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Filters',exact:true}).getAttribute('aria-expanded'),'true');
    await page.goto(`${BASE}/dictionary`);
    await page.getByPlaceholder(/word|phrase/i).first().fill('garden');
    await page.locator('article h2').filter({hasText:'garden'}).first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    mkdirSync('output/playwright',{recursive:true});
    await page.screenshot({path:'output/playwright/mobile-dictionary.png',fullPage:true});
  });
  await step('independent browser session sees persisted library and notes', async () => {
    const context=await browser.newContext({storageState:await page.context().storageState()});
    const second=await context.newPage();
    await second.goto(`${BASE}/document/${doc}`);
    await second.getByText('An edited original passage.',{exact:true}).last().waitFor();
    await context.close();
  });
  await step('quick reader exit preserves saved progress', async () => {
    const detail=await (await page.request.get(`${BASE}/api/library/${itemId}`)).json();
    assert.ok(detail.item.reading_progress>0, 'Opening and leaving the reader must not reset progress');
  });
  await step('remove test note', async () => {
    assert.equal((await page.request.delete(`${BASE}/api/entries/${entry}`)).status(),200);
  });
} finally { await browser.close(); }
finish(errors,'EPUB, notes, mobile, and persistence');
