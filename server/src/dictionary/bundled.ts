import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { insertEntries, type Lang, type UpsertEntry } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The bundles live beside the source rather than in the user's data directory:
 * they are part of the application, not of the user's library. `here` is
 * server/src/dictionary when running under tsx and server/dist/dictionary once
 * built, so both resolve to server/data/dictionaries.
 */
const BUNDLE_DIR = join(here, '..', '..', 'data', 'dictionaries');

export interface Bundle {
  file: string;
  lang: Lang;
  source: string;
  label: string;
}

export const BUNDLES: Bundle[] = [
  {
    file: 'wordnet-en.tsv.gz',
    lang: 'en',
    source: 'wordnet',
    label: 'WordNet 3.1 (English)',
  },
  {
    file: 'datuk-ml.tsv.gz',
    lang: 'ml',
    source: 'datuk',
    label: 'Datuk (Malayalam–Malayalam)',
  },
];

/**
 * Rows are `headword \t pos \t definition \t examples`; see ATTRIBUTION.md.
 *
 * Inserted in batches while streaming rather than collected into one array.
 * Holding all 207k English entries at once peaked at 255 MB, which is half of
 * a small hosting instance and risks the process being killed during its very
 * first boot — a failure that looks like nothing at all in the logs. Batched,
 * the same load stays flat.
 */
const BATCH_SIZE = 5_000;

async function loadBundle(path: string, bundle: Bundle): Promise<number> {
  const stream = createReadStream(path).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: UpsertEntry[] = [];
  let total = 0;

  for await (const line of rl) {
    if (!line) continue;
    const [headword, pos, definition, examples] = line.split('\t');
    if (!headword || !definition) continue;

    batch.push({
      lang: bundle.lang,
      source: bundle.source,
      headword,
      pos: pos || undefined,
      definition,
      examples: examples ? examples.split(' | ').filter(Boolean) : undefined,
    });

    if (batch.length >= BATCH_SIZE) {
      insertEntries(batch);
      total += batch.length;
      batch = [];
    }
  }

  if (batch.length) {
    insertEntries(batch);
    total += batch.length;
  }
  return total;
}

function alreadyLoaded(source: string): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM dict_entries WHERE source = ?').get(source) as {
    n: number;
  };
  return row.n > 0;
}

export interface LoadReport {
  source: string;
  label: string;
  entries: number;
  skipped: boolean;
  missing?: boolean;
}

/**
 * Load every bundled dictionary that is not already in the database. Runs on
 * boot, so a fresh install has both languages working without any setup step —
 * an import you have to remember to run is an import that does not happen.
 *
 * Inserting ~355k rows takes a few seconds once; afterwards this is two
 * COUNT queries.
 */
export async function loadBundledDictionaries(
  log: (message: string) => void = () => {},
): Promise<LoadReport[]> {
  const reports: LoadReport[] = [];

  for (const bundle of BUNDLES) {
    if (alreadyLoaded(bundle.source)) {
      reports.push({ source: bundle.source, label: bundle.label, entries: 0, skipped: true });
      continue;
    }

    const path = join(BUNDLE_DIR, bundle.file);
    if (!existsSync(path)) {
      log(`Bundled dictionary ${bundle.file} is missing; skipping ${bundle.label}.`);
      reports.push({
        source: bundle.source,
        label: bundle.label,
        entries: 0,
        skipped: true,
        missing: true,
      });
      continue;
    }

    log(`Loading ${bundle.label} …`);
    const entries = await loadBundle(path, bundle);
    log(`Loaded ${entries.toLocaleString()} entries from ${bundle.label}.`);
    reports.push({ source: bundle.source, label: bundle.label, entries, skipped: false });
  }

  return reports;
}
