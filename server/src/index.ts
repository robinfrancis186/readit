import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { ZodError } from 'zod';
import { HOST, MAX_UPLOAD_BYTES, PORT, WEB_DIST } from './config.js';
import './db.js';
import { seedMalayalamIfEmpty } from './dictionary/seed-ml.js';
import { dictionaryRoutes } from './routes/dictionary.js';
import { documentRoutes } from './routes/documents.js';
import { libraryRoutes } from './routes/library.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 16 * 1024 * 1024,
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

const seeded = seedMalayalamIfEmpty();
if (seeded) app.log.info(`Seeded ${seeded} starter Malayalam dictionary entries`);

await app.listen({ port: PORT, host: HOST });
app.log.info(`Readit API listening on http://${HOST}:${PORT}`);
