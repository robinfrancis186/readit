import './setup.js';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

const { lookup, normalise, detectLang, insertEntries, searchDefinitions } = await import(
  '../src/dictionary/index.js'
);
const { seedMalayalamIfEmpty } = await import('../src/dictionary/seed-ml.js');
const { wordnetRows, datukHeadword } = await import('../src/scripts/build-dictionaries.js');

before(() => {
  seedMalayalamIfEmpty();
  insertEntries([
    { lang: 'en', source: 'wordnet', headword: 'vulture', definition: 'any of various large diurnal birds of prey' },
    { lang: 'en', source: 'wordnet', headword: 'feast', definition: 'a ceremonial dinner for many people' },
    { lang: 'en', source: 'wordnet', headword: 'democracy', definition: 'the political orientation of those who favor government by the people' },
  ]);
});

describe('normalise', () => {
  it('keeps Malayalam combining vowel signs', () => {
    // \p{M} characters are not \p{L}: trimming naively truncates the word.
    assert.equal(normalise('ഭാഷയുടെ'), 'ഭാഷയുടെ');
    assert.equal(normalise('പുസ്തകം'), 'പുസ്തകം');
  });

  it('strips surrounding punctuation and zero-width joiners', () => {
    assert.equal(normalise('  “Vulture,”  '), 'vulture');
    assert.equal(normalise('ഭാഷ‍'), 'ഭാഷ');
  });
});

describe('chillu folding', () => {
  // Malayalam writes these six letters two ways. Older digitisations (Datuk
  // among them) use consonant + virama + ZWJ; modern text uses the atomic
  // letter. Unfolded, 38% of the bundled Malayalam vocabulary is unreachable.
  const pairs: Array<[legacy: string, modern: string]> = [
    ['മനുഷ്യന്\u200d', 'മനുഷ്യൻ'],
    ['അധ്യാപകന്\u200d', 'അധ്യാപകൻ'],
    ['വര്\u200dഷം', 'വർഷം'],
    ['ആള്\u200d', 'ആൾ'],
    ['മുന്\u200dപ്', 'മുൻപ്'],
  ];

  for (const [legacy, modern] of pairs) {
    it(`folds ${modern} to one key regardless of encoding`, () => {
      assert.equal(normalise(legacy), normalise(modern));
      assert.equal(normalise(legacy), modern.toLowerCase());
    });
  }

  it('leaves a virama that is not a chillu alone', () => {
    // No ZWJ, so this is a genuine conjunct, not a chillu.
    assert.equal(normalise('പുസ്തകം'), 'പുസ്തകം');
  });
});

describe('detectLang', () => {
  it('recognises Malayalam script', () => {
    assert.equal(detectLang('ജനാധിപത്യം'), 'ml');
    assert.equal(detectLang('democracy'), 'en');
  });
});

describe('Malayalam lookup', () => {
  it('finds an exact headword', async () => {
    const res = await lookup('സത്യം');
    assert.equal(res.results[0]?.headword, 'സത്യം');
    assert.equal(res.results[0]?.match, 'exact');
  });

  // Every one of these appears in running text but never as a dictionary headword.
  const inflected: Array<[string, string]> = [
    ['ഭാഷയുടെ', 'ഭാഷ'],
    ['പുസ്തകത്തിൽ', 'പുസ്തകം'],
    ['വാക്കുകൾ', 'വാക്ക്'],
    ['ജനാധിപത്യത്തിന്റെ', 'ജനാധിപത്യം'],
    ['ഗ്രന്ഥശാലയിലേക്ക്', 'ഗ്രന്ഥശാല'],
  ];

  for (const [surface, headword] of inflected) {
    it(`resolves the inflected form ${surface} to ${headword}`, async () => {
      const res = await lookup(surface);
      assert.equal(res.results[0]?.headword, headword, `expected ${surface} → ${headword}`);
      assert.equal(res.results[0]?.match, 'stem');
    });
  }

  it('returns nothing for a non-word', async () => {
    const res = await lookup('ക്ക്ക്ക്ക്');
    assert.equal(res.results.length, 0);
  });
});

describe('English lookup', () => {
  it('finds an exact headword', async () => {
    const res = await lookup('vulture');
    assert.equal(res.results[0]?.headword, 'vulture');
  });

  it('is case and punctuation insensitive', async () => {
    const res = await lookup('“Vultures”');
    assert.equal(res.results[0]?.headword, 'vulture');
  });

  it('falls back to the head word of a phrase', async () => {
    const res = await lookup('feast of vultures');
    assert.ok(res.results.length > 0);
  });

  it('reports when the language has no data loaded', async () => {
    const res = await lookup('supercalifragilistic');
    assert.equal(res.results.length, 0);
  });
});

describe('definition search', () => {
  it('matches on definition text', () => {
    const results = searchDefinitions('birds', 'en');
    assert.ok(results.some((r) => r.headword === 'vulture'));
  });
});

describe('bundle builder', () => {
  const cols = (row: string) => row.split('\t');

  it('splits a synset into one row per word, with examples', () => {
    const rows = wordnetRows(
      '03467517 06 n 02 guitar 0 guitar_player 0 003 @ 03800933 n 0000 | a stringed instrument; "he plays guitar"',
    );
    assert.equal(rows.length, 2);
    assert.equal(cols(rows[0])[0], 'guitar');
    assert.equal(cols(rows[1])[0], 'guitar player');
    assert.equal(cols(rows[0])[1], 'noun');
    assert.equal(cols(rows[0])[2], 'a stringed instrument');
    assert.equal(cols(rows[0])[3], 'he plays guitar');
  });

  it('strips adjective position markers', () => {
    const rows = wordnetRows('00001740 00 a 01 abaxial(a) 0 001 ! 00002098 a 0000 | facing away from the axis');
    assert.equal(cols(rows[0])[0], 'abaxial');
  });

  it('ignores licence header lines', () => {
    assert.deepEqual(wordnetRows('  1 This software and database is being provided'), []);
  });

  it('strips Datuk homograph markers from headwords', () => {
    // അ1 and അ2 are separate records for the same written word.
    assert.equal(datukHeadword('അ1'), 'അ');
    assert.equal(datukHeadword('അക1'), 'അക');
    assert.equal(datukHeadword('പകിടി'), 'പകിടി');
  });
});
