/**
 * Import the offline WordNet 3.1 database as the default English dictionary.
 *
 *   npm run import:wordnet
 *
 * WordNet ships with the `wordnet-db` package. Oxford is supported as a live
 * provider instead/as well — set OXFORD_APP_ID and OXFORD_APP_KEY. See
 * docs/DICTIONARIES.md.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { clearSource, insertEntries, type UpsertEntry } from '../dictionary/index.js';

const SOURCE = 'wordnet';

const POS_NAMES: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  s: 'adjective',
  r: 'adverb',
};

const DATA_FILES = ['data.noun', 'data.verb', 'data.adj', 'data.adv'];

async function resolveDictDir(): Promise<string> {
  const override = process.env.WORDNET_DICT_DIR;
  if (override) return override;
  try {
    const mod = (await import('wordnet-db')) as { default?: { path: string }; path?: string };
    const path = mod.path ?? mod.default?.path;
    if (path) return path;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    'wordnet-db is not installed. Run `npm install wordnet-db --workspace server`, ' +
      'or point WORDNET_DICT_DIR at a WordNet `dict` directory.',
  );
}

/**
 * A data-file line looks like:
 *   03467517 06 n 02 guitar 0 ... | a stringed instrument ...; "he plays guitar"
 * Everything before the `|` is the synset record; after it is the gloss, which
 * is a definition followed by zero or more quoted examples.
 */
function parseLine(line: string): UpsertEntry[] {
  if (line.startsWith('  ') || !line.trim()) return [];

  const barIndex = line.indexOf('|');
  if (barIndex < 0) return [];

  const fields = line.slice(0, barIndex).trim().split(/\s+/);
  // offset, lex_filenum, ss_type, w_cnt(hex), then w_cnt × (word, lex_id)
  const ssType = fields[2];
  const wordCount = parseInt(fields[3], 16);
  if (!Number.isFinite(wordCount) || wordCount < 1) return [];

  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const raw = fields[4 + i * 2];
    if (!raw) break;
    words.push(
      raw
        .replace(/\(.*?\)$/, '') // adjective position markers: (a), (p), (ip)
        .replace(/_/g, ' '),
    );
  }

  const gloss = line.slice(barIndex + 1).trim();
  const examples: string[] = [];
  const definitionParts: string[] = [];
  for (const chunk of splitGloss(gloss)) {
    if (chunk.startsWith('"')) examples.push(chunk.replace(/^"|"$/g, '').trim());
    else definitionParts.push(chunk);
  }
  const definition = definitionParts.join('; ').trim();
  if (!definition) return [];

  const pos = POS_NAMES[ssType] ?? undefined;
  return words
    .filter(Boolean)
    .map((headword) => ({ lang: 'en' as const, source: SOURCE, headword, pos, definition, examples }));
}

/** Split a gloss on semicolons that sit outside quoted examples. */
function splitGloss(gloss: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of gloss) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

async function main(): Promise<void> {
  const dictDir = await resolveDictDir();
  console.log(`Reading WordNet from ${dictDir}`);

  clearSource(SOURCE);

  let total = 0;
  for (const file of DATA_FILES) {
    const path = join(dictDir, file);
    if (!existsSync(path)) {
      console.warn(`  skipping ${file} (not found)`);
      continue;
    }

    let batch: UpsertEntry[] = [];
    let fileCount = 0;
    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of rl) {
      const entries = parseLine(line);
      if (!entries.length) continue;
      batch.push(...entries);
      fileCount += entries.length;
      // Batched inserts keep the transaction (and memory) bounded.
      if (batch.length >= 5000) {
        insertEntries(batch);
        batch = [];
      }
    }
    if (batch.length) insertEntries(batch);
    total += fileCount;
    console.log(`  ${file}: ${fileCount} senses`);
  }

  console.log(`\nImported ${total} English senses from WordNet.`);
}

const invokedDirectly = process.argv[1]?.includes('import-wordnet');
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { parseLine };
