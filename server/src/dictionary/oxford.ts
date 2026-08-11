import { OXFORD_APP_ID, OXFORD_APP_KEY } from '../config.js';
import type { DictionaryResult, Sense } from './index.js';

const BASE = 'https://od-api-sandbox.oxforddictionaries.com/api/v2';

/**
 * Optional remote provider. Oxford requires a licensed API key, so this stays
 * dormant unless OXFORD_APP_ID / OXFORD_APP_KEY are set — the offline WordNet
 * import is the default English dictionary. See docs/DICTIONARIES.md.
 */
export async function lookupOxford(word: string): Promise<DictionaryResult[]> {
  if (!OXFORD_APP_ID || !OXFORD_APP_KEY) return [];

  const url = `${BASE}/entries/en-gb/${encodeURIComponent(word)}?strictMatch=false`;
  const res = await fetch(url, {
    headers: { app_id: OXFORD_APP_ID, app_key: OXFORD_APP_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];

  const body = (await res.json()) as OxfordResponse;
  const results: DictionaryResult[] = [];

  for (const result of body.results ?? []) {
    const senses: Sense[] = [];
    for (const entry of result.lexicalEntries ?? []) {
      for (const sub of entry.entries ?? []) {
        for (const sense of sub.senses ?? []) {
          collectSense(sense, entry.lexicalCategory?.text, senses);
        }
      }
    }
    if (senses.length) {
      results.push({
        headword: result.word,
        lang: 'en',
        source: 'oxford',
        match: 'exact',
        senses,
      });
    }
  }
  return results;
}

function collectSense(sense: OxfordSense, pos: string | undefined, out: Sense[]): void {
  for (const def of sense.definitions ?? []) {
    out.push({
      pos,
      definition: def,
      examples: sense.examples?.map((e) => e.text).filter(Boolean),
    });
  }
  for (const child of sense.subsenses ?? []) collectSense(child, pos, out);
}

interface OxfordResponse {
  results?: Array<{
    word: string;
    lexicalEntries?: Array<{
      lexicalCategory?: { text?: string };
      entries?: Array<{ senses?: OxfordSense[] }>;
    }>;
  }>;
}

interface OxfordSense {
  definitions?: string[];
  examples?: Array<{ text: string }>;
  subsenses?: OxfordSense[];
}
