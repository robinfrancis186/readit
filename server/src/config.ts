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

/**
 * Loopback by default. Readit has no accounts and no authentication, so
 * binding every interface would put the whole library — and the DELETE
 * endpoints — in reach of anyone on the same network. Reaching it from a
 * phone or another machine is a deliberate choice: set HOST=0.0.0.0, and
 * put it behind something that authenticates if the network is not yours.
 */
export const HOST = process.env.HOST ?? '127.0.0.1';

/** True when we are listening on more than loopback, which deserves a warning. */
export const IS_EXPOSED = !['127.0.0.1', 'localhost', '::1'].includes(HOST);

/** Built web assets, served by the API in production so there is one process. */
export const WEB_DIST = join(ROOT, 'web', 'dist');

/**
 * Set this to require a password before anything can be read or changed.
 * Essential on a public host; unnecessary on loopback. See docs/DEPLOY.md.
 */
export const READIT_PASSWORD = process.env.READIT_PASSWORD ?? '';

/** How long a sign-in lasts before it has to be repeated. */
export const SESSION_DAYS = Number(process.env.READIT_SESSION_DAYS ?? 30);

/** Optional Oxford Dictionaries API credentials (see docs/DICTIONARIES.md). */
export const OXFORD_APP_ID = process.env.OXFORD_APP_ID ?? '';
export const OXFORD_APP_KEY = process.env.OXFORD_APP_KEY ?? '';

export const MAX_UPLOAD_BYTES = Number(process.env.READIT_MAX_UPLOAD ?? 512 * 1024 * 1024);

for (const dir of [DATA_DIR, LIBRARY_DIR, COVER_DIR]) {
  mkdirSync(dir, { recursive: true });
}
