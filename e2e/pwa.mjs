/**
 * Checks that Readit is installable as an app and that its shell survives a
 * dropped connection.
 *
 * This suite exists because of a failure that is invisible in normal use: the
 * API's CORS layer stamped `Vary: Origin` on the static bundle, and since the
 * SPA's own `<script crossorigin>` requests send an Origin header while the
 * service worker's cache.add() does not, every precached asset missed and the
 * installed app booted to a blank page offline.
 *
 *   npm run test:e2e
 *
 * Requires the built app to be served by the server (npm run build && npm start).
 */
import { BASE, openBrowser, makeStep, finish } from './helpers.mjs';

const { browser, page, errors } = await openBrowser();
const { step } = makeStep();
const context = page.context();

await step('serves a valid web app manifest', async () => {
  const res = await page.request.get(`${BASE}/manifest.webmanifest`);
  if (!res.ok()) throw new Error(`manifest returned ${res.status()}`);

  const manifest = JSON.parse(await res.text());
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!manifest[field]) throw new Error(`manifest is missing "${field}"`);
  }
  if (manifest.display !== 'standalone') throw new Error('manifest must request standalone display');

  // Installability needs both a 192px and a 512px icon, plus a maskable one
  // for Android's adaptive icon shapes.
  const sizes = manifest.icons.map((i) => i.sizes);
  if (!sizes.includes('192x192') || !sizes.includes('512x512')) {
    throw new Error(`manifest needs 192 and 512 icons, has ${sizes.join(', ')}`);
  }
  if (!manifest.icons.some((i) => i.purpose === 'maskable')) {
    throw new Error('manifest needs a maskable icon');
  }

  for (const icon of manifest.icons) {
    const iconRes = await page.request.get(BASE + icon.src);
    if (!iconRes.ok()) throw new Error(`icon ${icon.src} returned ${iconRes.status()}`);
  }
});

await step('links the manifest and the iOS-only tags', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const head = await page.evaluate(() => ({
    manifest: !!document.querySelector('link[rel=manifest]'),
    appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
    appleCapable: !!document.querySelector('meta[name=apple-mobile-web-app-capable]'),
    themeColors: document.querySelectorAll('meta[name=theme-color]').length,
  }));
  // iOS ignores the manifest for the home-screen icon and standalone mode.
  for (const [key, value] of Object.entries(head)) {
    if (!value) throw new Error(`index.html is missing ${key}`);
  }
});

await step('static assets are not varied on Origin', async () => {
  // The precise regression this suite was written for.
  const html = await (await page.request.get(`${BASE}/index.html`)).text();
  const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
  if (!asset) throw new Error('no hashed asset found in index.html');

  const res = await page.request.get(BASE + asset);
  const vary = res.headers()['vary'] ?? '';
  if (/origin/i.test(vary)) {
    throw new Error(`asset ${asset} sends "Vary: ${vary}" — service worker caching will miss`);
  }
});

await step('registers a service worker and precaches the bundle', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const paths = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) paths.push(new URL(req.url).pathname);
    }
    return paths;
  });

  if (!cached.some((p) => p.startsWith('/assets/') && p.endsWith('.js'))) {
    throw new Error(`bundle was not precached: ${cached.join(', ')}`);
  }
  if (!cached.includes('/index.html')) throw new Error('app shell was not cached');
  if (cached.some((p) => p.startsWith('/api/'))) {
    throw new Error(`API responses must never be cached, found: ${cached.filter((p) => p.startsWith('/api/'))}`);
  }
});

await step('boots offline instead of showing a blank page', async () => {
  await context.setOffline(true);
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('header', { timeout: 15000 });

    const rendered = await page.evaluate(() => ({
      mounted: (document.getElementById('root')?.children.length ?? 0) > 0,
      text: document.body.innerText,
    }));
    if (!rendered.mounted) throw new Error('the app did not mount offline');
    if (!rendered.text.includes('Readit')) throw new Error('the shell rendered without its chrome');
    // The library itself needs the API, so it must say so in plain words.
    if (!/offline/i.test(rendered.text)) {
      throw new Error(`expected an offline explanation, got: ${rendered.text.slice(0, 120)}`);
    }
  } finally {
    await context.setOffline(false);
  }
});

await browser.close();
// Going offline necessarily logs failed requests; those are the point of the
// test, not a defect.
finish(
  errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to load resource/.test(e)),
  'PWA install and offline',
);
