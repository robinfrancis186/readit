import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { libraryDb as db } from '../library-db.js';

const enabled = async () => (await db.prepare("SELECT value FROM settings WHERE key = 'reading_analytics'").get())?.value === 'true';
const daySchema = z.string().date();
export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics/settings', async () => ({ enabled: await enabled() }));
  app.put('/api/analytics/settings', async (req) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    await db.prepare("INSERT INTO settings (key, value) VALUES ('reading_analytics', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(body.enabled));
    return body;
  });
  app.post('/api/analytics/session', async (req, reply) => {
    const b = z.object({ id: z.string().uuid(), itemId: z.number().int().positive(), day: daySchema, seconds: z.number().int().min(0).max(86400) }).parse(req.body);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(Date.parse(b.day) - Date.now()) > 2 * 86400000) return reply.code(400).send({ error: 'Reading date is out of range.' });
    return db.transaction(async () => {
      if (!await enabled()) return { enabled: false };
      if (!await db.prepare('SELECT id FROM items WHERE id = ?').get(b.itemId)) return reply.code(404).send({ error: 'Book not found.' });
      const prior = await db.prepare('SELECT * FROM reading_sessions WHERE id = ?').get(b.id);
      if (prior && (prior.item_id !== b.itemId || prior.day !== b.day)) return reply.code(400).send({ error: 'Session does not match this book or date.' });
      // A cumulative snapshot makes retries and out-of-order requests harmless.
      // The clock bound prevents a session from reporting more time than elapsed.
      const seconds = Math.min(b.seconds, prior ? Math.max(0, now - prior.started_at + 2) : 0);
      await db.prepare(`INSERT INTO reading_sessions (id, item_id, day, seconds, started_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET seconds = MAX(reading_sessions.seconds, excluded.seconds)`)
        .run(b.id, b.itemId, b.day, seconds, now);
      return { enabled: true };
    })();
  });
  app.get('/api/analytics', async (req) => {
    const q = z.object({ today: daySchema, days: z.enum(['7', '30', 'all']).default('30') }).parse(req.query);
    const start = q.days === 'all' ? '0000-01-01' : new Date(Date.parse(q.today) - (Number(q.days) - 1) * 86400000).toISOString().slice(0, 10);
    const daily = await db.prepare('SELECT day, SUM(seconds) AS seconds FROM reading_sessions WHERE day <= ? AND seconds > 0 GROUP BY day ORDER BY day').all(q.today);
    const books = await db.prepare(`SELECT i.id, i.title, i.reading_progress, SUM(s.seconds) AS seconds, COUNT(DISTINCT s.day) AS days
      FROM reading_sessions s JOIN items i ON i.id = s.item_id WHERE s.day BETWEEN ? AND ? AND s.seconds > 0
      GROUP BY i.id ORDER BY seconds DESC, i.id`).all(start, q.today);
    const notes = await db.prepare(`SELECT SUM(CASE WHEN kind = 'word' THEN 1 ELSE 0 END) AS words,
      SUM(CASE WHEN kind = 'excerpt' THEN 1 ELSE 0 END) AS excerpts FROM entries WHERE reading_date BETWEEN ? AND ?`).get(start, q.today);
    const activeDays = new Set(daily.filter(d => d.seconds >= 60).map(d => d.day));
    let cursor = Date.parse(q.today), streak = 0;
    if (!activeDays.has(q.today)) cursor -= 86400000;
    while (activeDays.has(new Date(cursor).toISOString().slice(0, 10))) { streak++; cursor -= 86400000; }
    return { enabled: await enabled(), daily: daily.filter(d => d.day >= start), books, streak, notes: { words: notes.words ?? 0, excerpts: notes.excerpts ?? 0 } };
  });
}
