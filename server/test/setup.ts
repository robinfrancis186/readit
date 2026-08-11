import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Point the app at a throwaway data directory before anything imports db.ts,
 * which opens the SQLite file at module load.
 */
const dir = mkdtempSync(join(tmpdir(), 'readit-test-'));
process.env.READIT_DATA_DIR = dir;

process.on('exit', () => {
  rmSync(dir, { recursive: true, force: true });
});

export const TEST_DATA_DIR = dir;
