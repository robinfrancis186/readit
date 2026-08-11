import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root, whether we're running from src/ (tsx) or dist/ (built). */
export const ROOT = resolve(here, '../..');

function fromEnv(name: string, fallback: string): string {
  const v = process.env[name];
  if (!v) return fallback;
  return isAbsolute(v) ? v : resolve(ROOT, v);
}

/** Everything the user owns lives here: the SQLite db, uploads, covers. */
export const DATA_DIR = fromEnv('READIT_DATA_DIR', join(ROOT, 'data'));
export const LIBRARY_DIR = join(DATA_DIR, 'library');
export const COVER_DIR = join(DATA_DIR, 'covers');

export const PORT = Number(process.env.PORT ?? 4000);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** Built web assets, served by the API in production so there is one process. */
export const WEB_DIST = join(ROOT, 'web', 'dist');

/** Optional Oxford Dictionaries API credentials (see docs/DICTIONARIES.md). */
export const OXFORD_APP_ID = process.env.OXFORD_APP_ID ?? '';
export const OXFORD_APP_KEY = process.env.OXFORD_APP_KEY ?? '';

export const MAX_UPLOAD_BYTES = Number(process.env.READIT_MAX_UPLOAD ?? 512 * 1024 * 1024);

for (const dir of [DATA_DIR, LIBRARY_DIR, COVER_DIR]) {
  mkdirSync(dir, { recursive: true });
}
