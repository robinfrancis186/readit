import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { BASE, openBrowser, makeStep, finish } from './helpers.mjs';
const { browser, page, errors } = await openBrowser();
const { step } = makeStep();
let itemId, original;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const report = async () => (await page.request.get(`${BASE}/api/analytics?today=${today()}&days=all`)).json();
try {
  if (process.env.READIT_PASSWORD) assert.equal((await page.request.post(`${BASE}/api/auth/login`, { data: {password:process.env.READIT_PASSWORD} })).status(),200);
  original=(await (await page.request.get(`${BASE}/api/analytics/settings`)).json()).enabled;
  await page.request.put(`${BASE}/api/analytics/settings`,{data:{enabled:false}});
  await step('enable optional tracking from the analytics page',async()=>{
    await page.goto(`${BASE}/analytics`);
    await page.getByRole('button',{name:'Enable tracking',exact:true}).click();
    await page.getByRole('button',{name:'Pause tracking',exact:true}).waitFor();
  });
  await step('open an original test EPUB and record real reading time',async()=>{
    const title=`Analytics check ${Date.now()}`;
    const zip=new AdmZip(readFileSync(new URL('./fixtures/reading-garden.epub',import.meta.url)));
    zip.updateFile('OEBPS/content.opf',Buffer.from(zip.readAsText('OEBPS/content.opf').replace('The Reading Garden',title)));
    await page.goto(BASE);
    await page.getByRole('button',{name:/Add to library/}).click();
    await page.locator('input[type=file]').setInputFiles({name:'analytics.epub',mimeType:'application/epub+zip',buffer:zip.toBuffer()});
    await page.getByRole('button',{name:/^Import/}).click();
    const link=page.getByRole('link').filter({hasText:title}).first();
    await link.waitFor({timeout:120000});await link.click();itemId=Number(page.url().split('/').pop());
    await page.goto(`${BASE}/read/${itemId}`);
    await page.getByRole('link',{name:'Tracking reading',exact:true}).waitFor({timeout:30000});
    const deadline=Date.now()+25000;
    while(Date.now()<deadline){const r=await report();if(r.books.find(b=>b.id===itemId)?.seconds>=10)break;await new Promise(r=>setTimeout(r,1000));}
    assert.ok((await report()).books.find(b=>b.id===itemId)?.seconds>=10);
  });
  await step('idle pauses tracking and EPUB interaction resumes it',async()=>{
    await page.clock.install();
    await page.clock.fastForward(121000);
    await page.getByRole('link',{name:'Tracking paused',exact:true}).waitFor();
    await page.locator('iframe').first().contentFrame().locator('body').click();
    await page.clock.runFor(1200);
    await page.getByRole('link',{name:'Tracking reading',exact:true}).waitFor();
  });
  await step('dashboard persists real totals and fits mobile',async()=>{
    await page.goto(`${BASE}/analytics`);
    await page.getByRole('heading',{name:'Reading analytics'}).waitFor();
    await page.getByRole('heading',{name:'Time with each book'}).waitFor();
    assert.ok((await report()).books.find(b=>b.id===itemId)?.seconds>=10);
    mkdirSync('output/playwright',{recursive:true});
    await page.screenshot({path:'output/playwright/analytics-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'output/playwright/analytics-mobile.png',fullPage:true});
    await page.getByLabel('Period',{exact:true}).selectOption('7');
    await page.getByRole('heading',{name:'Time with each book'}).waitFor();
    await page.getByRole('button',{name:'Pause tracking',exact:true}).click();
    await page.getByRole('button',{name:'Enable tracking',exact:true}).waitFor();
  });
  await step('paused tracking leaves totals unchanged',async()=>{
    const before=(await report()).books.find(b=>b.id===itemId).seconds;
    await page.goto(`${BASE}/read/${itemId}`);
    await page.getByRole('link',{name:'Tracking off',exact:true}).waitFor();
    await page.clock.runFor(20000);
    assert.equal((await report()).books.find(b=>b.id===itemId).seconds,before);
  });
} finally {
  if(itemId) await page.request.delete(`${BASE}/api/library/${itemId}`);
  if(typeof original==='boolean')await page.request.put(`${BASE}/api/analytics/settings`,{data:{enabled:original}});
  await browser.close();
}
// Playwright's clock also tries to instrument the deliberately script-disabled EPUB iframe.
finish(errors.filter(e => !e.includes("Blocked script execution in 'about:srcdoc'")), 'Optional reading analytics');
