import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { sep } from 'node:path';
import { ZodError } from 'zod';
import { HOST, IS_EXPOSED, MAX_UPLOAD_BYTES, PORT, WEB_DIST } from './config.js';
import { authRequired, registerAuth } from './auth.js';
import './db.js';
import { loadBundledDictionaries } from './dictionary/bundled.js';
import { renormaliseIfNeeded } from './dictionary/index.js';
import { seedMalayalamIfEmpty } from './dictionary/seed-ml.js';
import { dictionaryRoutes } from './routes/dictionary.js';
import { documentRoutes } from './routes/documents.js';
import { libraryRoutes } from './routes/library.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 16 * 1024 * 1024,
  // Hosting platforms terminate TLS and proxy through, so the real client IP
  // and scheme arrive in X-Forwarded-*. Needed for login throttling and for
  // setting a Secure cookie.
  trustProxy: true,
});

await app.register(multipart, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 20 },
});

app.setErrorHandler((error: unknown, _req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: 'Invalid request', details: error.flatten() });
  }
  const err = error as { statusCode?: number; message?: string };
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: err.message || 'Internal error' });
});

/*
 * CORS is scoped to the API rather than registered globally. Globally it also
 * stamps `Vary: Origin` on the static bundle, and because the SPA's own
 * <script crossorigin> requests carry an Origin header while a service worker's
 * cache.add() does not, that Vary makes every precached asset miss — the app
 * then fails to boot offline. Fastify's encapsulation keeps the hooks here.
 */
await app.register(async (api) => {
  await api.register(cors, { origin: true });
  // Registered inside the API scope so the hook guards the routes below it and
  // never the static assets.
  registerAuth(api);
  await api.register(libraryRoutes);
  await api.register(documentRoutes);
  await api.register(dictionaryRoutes);
  api.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));
});

// In production the API also serves the built SPA, so `npm start` is one process.
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    // Turn off the plugin's own Cache-Control so ours is not overwritten.
    cacheControl: false,
    setHeaders(res, path) {
      // Bundle filenames are content-hashed, so they can be cached forever.
      // index.html and the worker must not be, or updates never land.
      if (path.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

// Order matters. On an upgrade this rewrites the existing keys and the bundles
// below are then skipped; on a fresh install there is nothing to rewrite, so it
// just records the version and the bundles load already-normalised.
renormaliseIfNeeded((message) => app.log.info(message));

// Both dictionaries ship with Readit and load themselves on first boot, so a
// fresh install can look words up in Malayalam and English straight away.
await loadBundledDictionaries((message) => app.log.info(message));

const seeded = seedMalayalamIfEmpty();
if (seeded) app.log.info(`Seeded ${seeded} Malayalam glosses in English`);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  // Starting it twice is an ordinary mistake, not a crash. A Node stack trace
  // tells a reader nothing they can act on.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — Readit may already be running.\n` +
        `Open http://localhost:${PORT} to check, or start this one on another ` +
        `port with:\n\n  PORT=4001 npm start\n`,
    );
    process.exit(1);
  }
  throw err;
}

/**
 * Print somewhere you can actually click or type. `0.0.0.0` is not an address
 * you can open on a phone, and looking up your own machine's LAN address is a
 * small chore that gets in the way of the one thing this is for.
 */
function addresses(): string[] {
  const urls = [`http://localhost:${PORT}`];
  if (!IS_EXPOSED) return urls;

  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  return urls;
}

const urls = addresses();
app.log.info(`Readit is ready at ${urls[0]}`);
if (urls.length > 1) {
  app.log.info(`On the same network, open ${urls.slice(1).join(' or ')}`);
}

if (authRequired()) {
  app.log.info('Password protection is on.');
} else if (IS_EXPOSED) {
  app.log.warn(
    `Bound to ${HOST} with no password set, so anyone who can reach this port ` +
      'can read and delete your library. Set READIT_PASSWORD, or only do this ' +
      'on a network you trust.',
  );
} else {
  app.log.info('Bound to loopback only. Set HOST=0.0.0.0 to reach Readit from your phone.');
}
