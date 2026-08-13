import './setup.js';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { loadBundledDictionaries, BUNDLES } = await import('../src/dictionary/bundled.js');
const { lookup, countEntries } = await import('../src/dictionary/index.js');
const { db } = await import('../src/db.js');

const BUNDLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'dictionaries');

/**
 * These exercise the dictionary files that are actually committed, not a
 * fixture. They are the guarantee behind "lookup works offline with no setup",
 * so they load the real bundles once and query them.
 */
describe('bundled dictionaries', () => {
  before(async () => {
    await loadBundledDictionaries();
  });

  it('ships a file for every declared bundle', () => {
    for (const bundle of BUNDLES) {
      assert.ok(existsSync(join(BUNDLE_DIR, bundle.file)), `${bundle.file} is missing from the repo`);
    }
  });

  it('loads both languages with substantial vocabulary', () => {
    // Guards against a truncated or half-written bundle being committed.
    assert.ok(countEntries('en') > 200_000, `English: ${countEntries('en')}`);
    assert.ok(countEntries('ml') > 140_000, `Malayalam: ${countEntries('ml')}`);
  });

  it('does not reload on a second call', async () => {
    const before = countEntries();
    const reports = await loadBundledDictionaries();
    assert.equal(countEntries(), before, 'entries must not be duplicated');
    assert.ok(reports.every((r) => r.skipped));
  });

  it('looks up English words offline', async () => {
    const res = await lookup('vulture');
    assert.equal(res.results[0]?.source, 'wordnet');
    assert.match(res.results[0].senses[0].definition, /bird/i);
  });

  it('looks up Malayalam words offline', async () => {
    const res = await lookup('ജനാധിപത്യം');
    assert.ok(res.results.some((r) => r.source === 'datuk'), 'expected a Datuk entry');
  });

  it('finds words written with a modern atomic chillu', async () => {
    // Datuk stores these as consonant + virama + ZWJ. Without folding, a word
    // selected from a modern EPUB never matches — 38% of the corpus.
    for (const word of ['മനുഷ്യൻ', 'അധ്യാപകൻ', 'വർഷം', 'ആൾ', 'സൂര്യൻ']) {
      const res = await lookup(word);
      assert.ok(
        res.results.some((r) => r.source === 'datuk'),
        `${word} should resolve against Datuk`,
      );
    }
  });

  it('stores no headword key containing a legacy chillu sequence', () => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM dict_entries
          WHERE headword_norm LIKE '%' || char(3405) || char(8205) || '%'`,
      )
      .get() as { n: number };
    assert.equal(row.n, 0, 'lookup keys must be folded to atomic chillu');
  });

  it('resolves an inflected Malayalam word to its headword', async () => {
    const res = await lookup('മനുഷ്യന്റെ');
    assert.ok(res.results.length > 0, 'expected the possessive to reach a headword');
  });
});
