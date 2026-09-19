import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { BASE, openBrowser, makeStep, finish } from './helpers.mjs';
const { browser, page, errors } = await openBrowser();
const { step } = makeStep();
let itemId;
try {
  await page.goto(BASE);
  await page.getByLabel('Password').fill(process.env.READIT_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Search the library').waitFor();
  assert.equal((await (await page.request.get(`${BASE}/api/library/storage`)).json()).cloud,true);
  const zip = new AdmZip(readFileSync(new URL('./fixtures/reading-garden.epub',import.meta.url)));
  zip.updateFile('OEBPS/content.opf',Buffer.from(zip.readAsText('OEBPS/content.opf').replace('The Reading Garden','Large Upload Verification')));
  zip.addFile('padding.bin',randomBytes(6*1024*1024));
  const book=zip.toBuffer();
  assert.ok(book.length>4.5*1024*1024);
  await step('upload a 6 MiB EPUB directly into private Blob',async()=>{
    await page.getByRole('button',{name:/Add to library/}).click();
    await page.locator('input[type=file]').setInputFiles({name:'large-verification.epub',mimeType:'application/epub+zip',buffer:book});
    await page.getByRole('button',{name:/^Import/}).click();
    const link=page.getByRole('link').filter({hasText:'Large Upload Verification'}).first();
    await link.waitFor({timeout:120000});await link.click();
    itemId=Number(page.url().split('/').pop());
  });
  await step('download persisted bytes and reject unauthenticated file access',async()=>{
    const res=await page.request.get(`${BASE}/api/library/${itemId}/file`);
    assert.equal(res.status(),200);assert.deepEqual(await res.body(),book);
    assert.match(res.headers()['cache-control'],/private/);
    const anonymous=await browser.newContext();
    assert.equal((await anonymous.request.get(`${BASE}/api/library/${itemId}/file`)).status(),401);
    await anonymous.close();
  });
  await step('delete the verification item and its private file',async()=>{
    assert.equal((await page.request.delete(`${BASE}/api/library/${itemId}`)).status(),200);
    assert.equal((await page.request.get(`${BASE}/api/library/${itemId}`)).status(),404);
    itemId=undefined;
  });
} finally {
  if(itemId) await page.request.delete(`${BASE}/api/library/${itemId}`);
  await browser.close();
}
finish(errors,'Large cloud upload and private access');
