/**
 * Regenerate the bundled dictionaries in server/data/dictionaries.
 *
 *   npm run build:dictionaries
 *
 * Run this when the upstream data updates. It is a maintenance script, not part
 * of installing or running Readit — the generated files are committed, which is
 * what lets word lookup work offline with no setup.
 *
 * Sources and licences are documented in
 * server/data/dictionaries/ATTRIBUTION.md.
 */
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', '..', 'data', 'dictionaries');

const DATUK_URL = 'https://raw.githubusercontent.com/knadh/datuk/master/datuk.yaml';

/** Field values are stored raw, so strip anything that would break the TSV. */
const clean = (value: unknown): string => String(value ?? '').replace(/[\t\n\r]+/g, ' ').trim();

function write(name: string, rows: string[]): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, gzipSync(Buffer.from(rows.join('\n'), 'utf8'), { level: 9 }));
  const mb = (statSync(path).size / 1e6).toFixed(2);
  console.log(`  wrote ${name}: ${rows.length.toLocaleString()} rows, ${mb} MB`);
}

// ---------------------------------------------------------------- WordNet ---

const POS: Record<string, string> = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };

/** Split a gloss on semicolons that sit outside quoted examples. */
export function splitGloss(gloss: string): string[] {
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

/** One WordNet data-file line -> the rows it contributes. Exported for tests. */
export function wordnetRows(line: string): string[] {
  if (line.startsWith('  ') || !line.trim()) return [];
  const bar = line.indexOf('|');
  if (bar < 0) return [];

  const fields = line.slice(0, bar).trim().split(/\s+/);
  const pos = POS[fields[2]] ?? '';
  const wordCount = parseInt(fields[3], 16);
  if (!Number.isFinite(wordCount) || wordCount < 1) return [];

  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const raw = fields[4 + i * 2];
    if (!raw) break;
    // Adjective position markers: abaxial(a), cardinal(ip).
    words.push(raw.replace(/\(.*?\)/g, '').replace(/_/g, ' '));
  }

  const examples: string[] = [];
  const definitions: string[] = [];
  for (const chunk of splitGloss(line.slice(bar + 1).trim())) {
    if (chunk.startsWith('"')) examples.push(chunk.replace(/"/g, '').trim());
    else definitions.push(chunk);
  }
  const definition = definitions.join('; ').trim();
  if (!definition) return [];

  return words
    .filter(Boolean)
    .map((word) => [clean(word), pos, clean(definition), clean(examples.slice(0, 2).join(' | '))].join('\t'));
}

/** Datuk headwords carry homograph markers — അ1, അ2 — which are not the word. */
export function datukHeadword(entry: string | undefined): string {
  return clean(entry).replace(/\d+$/, '').trim();
}

async function buildWordnet(): Promise<void> {
  console.log('WordNet (English)');
  let dictDir = process.env.WORDNET_DICT_DIR ?? '';
  if (!dictDir) {
    try {
      const mod = (await import('wordnet-db')) as { default?: { path: string }; path?: string };
      dictDir = mod.path ?? mod.default?.path ?? '';
    } catch {
      // handled below
    }
  }
  if (!dictDir || !existsSync(dictDir)) {
    console.log('  skipped: install wordnet-db, or set WORDNET_DICT_DIR to a WordNet dict directory');
    return;
  }

  const rows: string[] = [];
  for (const file of ['data.noun', 'data.verb', 'data.adj', 'data.adv']) {
    const path = join(dictDir, file);
    if (!existsSync(path)) continue;

    const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    for await (const line of rl) rows.push(...wordnetRows(line));
  }
  write('wordnet-en.tsv.gz', rows);
}

// ------------------------------------------------------------------ Datuk ---

interface DatukEntry {
  entry?: string;
  origin?: string;
  info?: string;
  defs?: Array<{ entry?: string; type?: string }>;
}

async function buildDatuk(): Promise<void> {
  console.log('Datuk (Malayalam–Malayalam)');
  const local = process.env.DATUK_YAML;
  let text: string;

  if (local && existsSync(local)) {
    text = (await import('node:fs')).readFileSync(local, 'utf8');
    console.log(`  reading ${local}`);
  } else {
    console.log(`  downloading ${DATUK_URL}`);
    const res = await fetch(DATUK_URL, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) {
      console.log(`  skipped: ${res.status} ${res.statusText}. Set DATUK_YAML to a local copy.`);
      return;
    }
    text = await res.text();
  }

  const entries = parseYaml(text) as DatukEntry[];
  const rows: string[] = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    const word = datukHeadword(entry.entry);
    if (!word) continue;

    const extra = [clean(entry.origin), clean(entry.info)].filter(Boolean).join(' ');
    for (const def of entry.defs ?? []) {
      const definition = clean(def?.entry);
      if (!definition) continue;
      rows.push([word, clean(def?.type), definition, extra].join('\t'));
    }
  }
  write('datuk-ml.tsv.gz', rows);
}

if (process.argv[1]?.includes('build-dictionaries')) {
  await buildWordnet();
  await buildDatuk();
  console.log(`\nBundles written to ${OUT_DIR}`);
}
