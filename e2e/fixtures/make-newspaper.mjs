/**
 * Build the sample newspaper issue used by the periodical e2e suite. It is
 * generated rather than committed so the PDF stays reproducible and small.
 *
 *   node e2e/fixtures/make-newspaper.mjs
 *
 * Note: the Malayalam passages only survive intact if a Malayalam font is
 * installed on the machine generating the PDF. Without one, Chromium drops the
 * conjunct glyphs — which is a limitation of this fixture, not of Readit.
 */
import { chromium } from 'playwright';

const OUT = new URL('./kerala-chronicle-2026-03-04.pdf', import.meta.url).pathname;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Georgia,serif;margin:48px;line-height:1.6}
h1{font-size:30px;border-bottom:3px double #000;padding-bottom:8px}
h2{font-size:19px;margin-top:28px}
.masthead{display:flex;justify-content:space-between;font-size:12px;letter-spacing:2px;text-transform:uppercase}
p{text-align:justify}
</style></head><body>
<div class="masthead"><span>Vol. 12 · No. 61</span><span>4 March 2026</span></div>
<h1>The Kerala Chronicle</h1>
<h2>Democracy and its discontents</h2>
<p>The machinery of democracy in India rests on an uneasy compact between the citizen and the state. Corruption, that persistent solvent of public trust, has proven remarkably adaptive: where scrutiny tightens in one quarter, influence simply migrates to another. The middleman, once a figure of the defence bazaar, now operates across telecommunications, mining and infrastructure.</p>
<p>Transparency campaigners argue that procurement reform without whistle-blower protection is ornamental. A contract awarded in daylight can still be negotiated in the dark.</p>
<h2>A note on language</h2>
<p>Readers have written to ask about the vocabulary of civic life. The Malayalam word for democracy is ജനാധിപത്യം, and the newspaper you are holding is a പത്രം. A library is a ഗ്രന്ഥശാല, and knowledge, that oldest of public goods, is അറിവ്.</p>
<p style="page-break-before:always"></p>
<h2>Books received</h2>
<p>A Feast of Vultures, by Josy Joseph, published by HarperCollins India in 2016, remains the most unsparing account of the hidden business of Indian democracy to appear in a decade. Our reviewer calls it essential and exhausting in equal measure.</p>
<p>Also received: three volumes of collected essays on education, or വിദ്യാഭ്യാസം, and a slim book of poems, കവിത, from a small press in Thrissur.</p>
<h2>Correspondence</h2>
<p>Sir — Your correspondent's account of the arms trade omitted the role of the financial intermediary. The commission does not vanish; it is merely relocated to a jurisdiction where questions are not asked. Truth, or സത്യം, is the first casualty of a well-structured invoice.</p>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({ path: OUT, format: 'A4', printBackground: true });
await browser.close();
console.log(`Wrote ${OUT}`);
