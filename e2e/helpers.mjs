import { chromium } from 'playwright';

export const BASE = process.env.READIT_URL ?? 'http://localhost:4000';

/**
 * Chromium is preinstalled in some CI images; fall back to Playwright's own
 * download everywhere else.
 */
const executablePath = process.env.CHROMIUM_PATH || undefined;

export async function openBrowser() {
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  return { browser, page, errors };
}

export function makeStep() {
  let failed = false;
  return {
    async step(name, fn) {
      process.stdout.write(`• ${name} … `);
      try {
        await fn();
        console.log('ok');
      } catch (err) {
        failed = true;
        console.log('FAIL');
        console.log('   ', err.message.split('\n')[0]);
        throw err;
      }
    },
    get failed() {
      return failed;
    },
  };
}

export function finish(errors, label) {
  if (errors.length) {
    console.log('\nBrowser errors:');
    for (const e of [...new Set(errors)].slice(0, 12)) console.log('  -', e);
    process.exit(1);
  }
  console.log(`\n${label}: passed with no console errors.`);
}

export const today = () => new Date().toISOString().slice(0, 10);
