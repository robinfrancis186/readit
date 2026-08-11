import { db } from '../db.js';
import { OXFORD_APP_ID, OXFORD_APP_KEY } from '../config.js';
import { lookupOxford } from './oxford.js';

export type Lang = 'ml' | 'en';

export interface Sense {
  pos?: string;
  definition: string;
  examples?: string[];
}

export interface DictionaryResult {
  headword: string;
  lang: Lang;
  source: string;
  /** 'exact' | 'stem' | 'prefix' — tells the UI how confident the match is. */
  match: 'exact' | 'stem' | 'prefix';
  senses: Sense[];
}

export interface LookupResponse {
  query: string;
  lang: Lang;
  results: DictionaryResult[];
  /** Set when nothing was found and the dictionary for that language is empty. */
  notice?: string;
}

const MALAYALAM_RANGE = /[ഀ-ൿ]/;

export function detectLang(text: string): Lang {
  return MALAYALAM_RANGE.test(text) ? 'ml' : 'en';
}

/**
 * Normalise a headword for lookup: NFC-compose, drop the zero-width joiners
 * Malayalam text is littered with, strip surrounding punctuation, lowercase.
 */
export function normalise(word: string): string {
  return word
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    // PDF text layers emit NULs and other control codes where a font was
    // missing a glyph; they must not end up inside a lookup key.
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    // \p{M} matters: Indic vowel signs and viramas are combining marks, not
    // letters, so trimming on \p{L}\p{N} alone would eat the tail of a word
    // like ഭാഷയുടെ and break every lookup.
    .replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Malayalam is agglutinative: a word in running text usually carries case,
 * plural or postpositional suffixes that are absent from the dictionary
 * headword. Try progressively shorter stems before giving up.
 */
const ML_SUFFIXES = [
  'യിലേക്ക്', 'ത്തിലേക്ക്', 'ങ്ങളുടെ', 'ങ്ങളിൽ', 'ത്തിന്റെ', 'യുടെ', 'ിന്റെ', 'ങ്ങൾ',
  'ത്തിൽ', 'യിൽ', 'ിൽ', 'ോട്', 'ിന്', 'ായി', 'ുടെ', 'ക്ക്', 'ുകൾ', 'ത്ത്',
  'ും', 'ിനെ', 'യെ', 'ാൽ', 'ാം', 'ം',
];

const EN_SUFFIXES = ['ing', 'edly', 'ies', 'ied', 'es', 'ed', 's', 'ly', 'ness', 'ment'];

function stemCandidates(word: string, lang: Lang): string[] {
  const out: string[] = [];
  const suffixes = lang === 'ml' ? ML_SUFFIXES : EN_SUFFIXES;
  for (const suffix of suffixes) {
    if (word.length > suffix.length + 1 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      out.push(stem);
      if (lang === 'ml') {
        // A Malayalam noun headword usually ends in anusvara (ം) or a virama
        // (്), and both are dropped before a case suffix is attached:
        // പുസ്തകം + ത്തിൽ → പുസ്തകത്തിൽ. Put them back to reach the headword.
        out.push(`${stem}ം`, `${stem}്`);
      } else {
        // English "ies" → "y", "ied" → "y"; doubled consonants ("running" → "run").
        if (suffix === 'ies' || suffix === 'ied') out.push(`${stem}y`);
        if (/([bdfglmnprt])\1$/.test(stem)) out.push(stem.slice(0, -1));
        out.push(`${stem}e`);
      }
    }
  }
  return [...new Set(out)];
}

interface DictRow {
  headword: string;
  source: string;
  pos: string | null;
  definition: string;
  examples: string | null;
}

function groupRows(rows: DictRow[], lang: Lang, match: DictionaryResult['match']): DictionaryResult[] {
  const grouped = new Map<string, DictionaryResult>();
  for (const row of rows) {
    const key = `${row.source}::${row.headword}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { headword: row.headword, lang, source: row.source, match, senses: [] };
      grouped.set(key, entry);
    }
    entry.senses.push({
      pos: row.pos ?? undefined,
      definition: row.definition,
      examples: row.examples ? (JSON.parse(row.examples) as string[]) : undefined,
    });
  }
  return [...grouped.values()];
}

function queryLocal(norm: string, lang: Lang, limit: number): DictRow[] {
  return db
    .prepare(
      `SELECT headword, source, pos, definition, examples
         FROM dict_entries
        WHERE headword_norm = ? AND lang = ?
        LIMIT ?`,
    )
    .all(norm, lang, limit) as DictRow[];
}

/**
 * Find headwords that the query *starts with*, longest first. In Malayalam a
 * running-text word is often a dictionary headword plus agglutinated suffixes
 * that no fixed suffix list can enumerate, so this recovers the head of the
 * compound the way you would scanning a printed dictionary.
 */
function queryHeadOfWord(norm: string, lang: Lang, limit: number): DictRow[] {
  // For Malayalam the comparison is made against the headword with its trailing
  // anusvara/virama removed, since that is the form suffixes attach to.
  const base = lang === 'ml' ? "RTRIM(headword_norm, 'ം്')" : 'headword_norm';
  return db
    .prepare(
      `SELECT headword, source, pos, definition, examples
         FROM dict_entries
        WHERE lang = ?
          AND LENGTH(${base}) >= 2
          AND LENGTH(${base}) < LENGTH(?)
          AND SUBSTR(?, 1, LENGTH(${base})) = ${base}
        ORDER BY LENGTH(${base}) DESC
        LIMIT ?`,
    )
    .all(lang, norm, norm, limit) as DictRow[];
}

function queryPrefix(norm: string, lang: Lang, limit: number): DictRow[] {
  return db
    .prepare(
      `SELECT headword, source, pos, definition, examples
         FROM dict_entries
        WHERE lang = ? AND headword_norm GLOB ?
        ORDER BY LENGTH(headword_norm) ASC
        LIMIT ?`,
    )
    .all(lang, `${norm.replace(/[[*?]/g, '')}*`, limit) as DictRow[];
}

export function countEntries(lang?: Lang): number {
  const row = lang
    ? (db.prepare('SELECT COUNT(*) AS n FROM dict_entries WHERE lang = ?').get(lang) as { n: number })
    : (db.prepare('SELECT COUNT(*) AS n FROM dict_entries').get() as { n: number });
  return row.n;
}

export async function lookup(rawQuery: string, langHint?: Lang): Promise<LookupResponse> {
  const query = rawQuery.trim();
  const lang = langHint ?? detectLang(query);
  const norm = normalise(query);

  if (!norm) return { query, lang, results: [] };

  // 1. Exact headword.
  let rows = queryLocal(norm, lang, 40);
  if (rows.length) return { query, lang, results: groupRows(rows, lang, 'exact') };

  // 2. Multi-word phrase: fall back to the head of the phrase.
  const words = norm.split(/\s+/);
  if (words.length > 1) {
    for (const w of words) {
      rows = queryLocal(w, lang, 20);
      if (rows.length) return { query, lang, results: groupRows(rows, lang, 'exact') };
    }
  }

  // 3. Strip inflectional suffixes.
  for (const stem of stemCandidates(words[words.length - 1] ?? norm, lang)) {
    rows = queryLocal(stem, lang, 20);
    if (rows.length) return { query, lang, results: groupRows(rows, lang, 'stem') };
  }

  // 4. The longest headword that the selected word begins with.
  rows = queryHeadOfWord(words[0] ?? norm, lang, 5);
  if (rows.length) return { query, lang, results: groupRows(rows, lang, 'stem') };

  // 5. Finally, offer headwords that begin with what was selected — useful when
  //    only part of a word was highlighted.
  rows = queryPrefix(words[0] ?? norm, lang, 10);
  if (rows.length) return { query, lang, results: groupRows(rows, lang, 'prefix') };

  // 6. Remote provider, if the user configured one.
  if (lang === 'en' && OXFORD_APP_ID && OXFORD_APP_KEY) {
    try {
      const remote = await lookupOxford(norm);
      if (remote.length) return { query, lang, results: remote };
    } catch {
      // Network/credential problems must not break the reading flow.
    }
  }

  const notice = countEntries(lang) === 0
    ? lang === 'ml'
      ? 'No Malayalam dictionary data is loaded yet. Run `npm run import:stv` to import Sabdatharavali.'
      : 'No English dictionary data is loaded yet. Run `npm run import:wordnet`.'
    : undefined;

  return { query, lang, results: [], notice };
}

/** Free-text search across definitions, for the dictionary browser page. */
export function searchDefinitions(q: string, lang: Lang | undefined, limit = 50): DictionaryResult[] {
  const match = q.trim().replace(/["']/g, '');
  if (!match) return [];
  const rows = db
    .prepare(
      `SELECT d.headword, d.source, d.pos, d.definition, d.examples, d.lang
         FROM dict_fts f
         JOIN dict_entries d ON d.id = f.rowid
        WHERE dict_fts MATCH ?
          ${lang ? 'AND d.lang = ?' : ''}
        ORDER BY rank
        LIMIT ?`,
    )
    .all(...(lang ? [`${match}*`, lang, limit] : [`${match}*`, limit])) as Array<
    DictRow & { lang: Lang }
  >;
  return rows.map((r) => ({
    headword: r.headword,
    lang: r.lang,
    source: r.source,
    match: 'exact' as const,
    senses: [
      {
        pos: r.pos ?? undefined,
        definition: r.definition,
        examples: r.examples ? (JSON.parse(r.examples) as string[]) : undefined,
      },
    ],
  }));
}

export interface UpsertEntry {
  lang: Lang;
  source: string;
  headword: string;
  pos?: string;
  definition: string;
  examples?: string[];
  rawHtml?: string;
}

const insertStmt = db.prepare(`
  INSERT INTO dict_entries (lang, source, headword, headword_norm, pos, definition, examples, raw_html)
  VALUES (@lang, @source, @headword, @headword_norm, @pos, @definition, @examples, @raw_html)
`);

export const insertEntries = db.transaction((entries: UpsertEntry[]) => {
  for (const e of entries) {
    insertStmt.run({
      lang: e.lang,
      source: e.source,
      headword: e.headword,
      headword_norm: normalise(e.headword),
      pos: e.pos ?? null,
      definition: e.definition,
      examples: e.examples?.length ? JSON.stringify(e.examples) : null,
      raw_html: e.rawHtml ?? null,
    });
  }
});

export function clearSource(source: string): void {
  db.prepare('DELETE FROM dict_entries WHERE source = ?').run(source);
}

export function dictionaryStats(): Array<{ source: string; lang: string; entries: number }> {
  return db
    .prepare(
      `SELECT source, lang, COUNT(*) AS entries FROM dict_entries GROUP BY source, lang ORDER BY source`,
    )
    .all() as Array<{ source: string; lang: string; entries: number }>;
}
