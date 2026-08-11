import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OXFORD_APP_ID, OXFORD_APP_KEY } from '../config.js';
import { dictionaryStats, lookup, searchDefinitions, type Lang } from '../dictionary/index.js';

const lookupQuery = z.object({
  q: z.string().min(1),
  lang: z.enum(['ml', 'en']).optional(),
});

const searchQuery = z.object({
  q: z.string().min(1),
  lang: z.enum(['ml', 'en']).optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
});

export async function dictionaryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/dictionary/lookup', async (req) => {
    const { q, lang } = lookupQuery.parse(req.query);
    return lookup(q, lang as Lang | undefined);
  });

  app.get('/api/dictionary/search', async (req) => {
    const { q, lang, limit } = searchQuery.parse(req.query);
    return { results: searchDefinitions(q, lang as Lang | undefined, limit) };
  });

  app.get('/api/dictionary/stats', async () => ({
    sources: dictionaryStats(),
    providers: {
      oxford: Boolean(OXFORD_APP_ID && OXFORD_APP_KEY),
    },
  }));
}
