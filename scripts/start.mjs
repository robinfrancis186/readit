#!/usr/bin/env node
/**
 * Start Readit with one command.
 *
 *   npm start           on this computer only
 *   npm start -- --lan  also reachable from your phone on the same network
 *
 * Builds first, but only when something has actually changed — a rebuild takes
 * about fifteen seconds and there is no reason to pay it every time you open
 * your library.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const lan = args.includes('--lan');

/** Newest mtime under a directory, ignoring the usual noise. */
function newestFile(dir, skip = new Set(['node_modules', 'dist', '.git', 'data'])) {
  let newest = 0;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const { mtimeMs } = statSync(path);
        if (mtimeMs > newest) newest = mtimeMs;
      }
    }
  };
  walk(dir);
  return newest;
}

function builtAt(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

const serverBuilt = builtAt(join(ROOT, 'server', 'dist', 'index.js'));
const webBuilt = builtAt(join(ROOT, 'web', 'dist', 'index.html'));
const sourceChanged = Math.max(
  newestFile(join(ROOT, 'server', 'src')),
  newestFile(join(ROOT, 'web', 'src')),
);

const stale = !serverBuilt || !webBuilt || sourceChanged > Math.min(serverBuilt, webBuilt);

if (stale) {
  console.log(serverBuilt && webBuilt ? 'Something changed — rebuilding…' : 'First run — building…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error('\nBuild failed. Fix the errors above and run `npm start` again.');
    process.exit(build.status ?? 1);
  }
}

const env = { ...process.env };
if (lan) {
  env.HOST = '0.0.0.0';
  if (!env.READIT_PASSWORD) {
    console.log(
      '\n  Note: --lan makes Readit reachable by anything on your network, and it\n' +
        '  has no password set. Anyone on the same Wi-Fi could read or delete your\n' +
        '  library. To require one:\n\n' +
        '    READIT_PASSWORD="a passphrase" npm start -- --lan\n',
    );
  }
}

const server = spawn(process.execPath, [join(ROOT, 'server', 'dist', 'index.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
});

// Pass Ctrl-C through so the database closes cleanly rather than being killed.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
