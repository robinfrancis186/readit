import './setup.js';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { ZodError } from 'zod';
const { db } = await import('../src/db.js');
const { analyticsRoutes } = await import('../src/routes/analytics.js');

it('analytics is opt-in, validates sessions, deduplicates snapshots and aggregates days/books', async () => {
  const app = Fastify();
  app.setErrorHandler((err: any, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: err.message }));
  await app.register(analyticsRoutes);
  const itemId = Number(db.prepare("INSERT INTO items(title,file_path,file_format) VALUES ('Analytics fixture','fixture.pdf','pdf')").run().lastInsertRowid);
  const day = new Date().toISOString().slice(0, 10), id = randomUUID();
  const post = (seconds: number, patch = {}) => app.inject({ method: 'POST', url: '/api/analytics/session', payload: { id, itemId, day, seconds, ...patch } });
  const setting = (enabled: boolean) => app.inject({ method: 'PUT', url: '/api/analytics/settings', payload: { enabled } });
  try {
    assert.equal((await app.inject('/api/analytics/settings')).json().enabled, false);
    assert.equal((await post(60)).json().enabled, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reading_sessions').get().n, 0);
    await setting(true);
    await post(999); // First snapshot only establishes the server clock.
    assert.equal(db.prepare('SELECT seconds FROM reading_sessions WHERE id=?').get(id).seconds, 0);
    db.prepare('UPDATE reading_sessions SET started_at = started_at - 120 WHERE id = ?').run(id);
    await post(90); await post(90); await post(30);
    assert.equal(db.prepare('SELECT seconds FROM reading_sessions WHERE id=?').get(id).seconds, 90);
    assert.equal((await post(-1)).statusCode, 400);
    assert.equal((await post(30, { day: '2020-01-01' })).statusCode, 400);
    assert.equal((await post(30, { itemId: 999999 })).statusCode, 404);
    const secondItem = Number(db.prepare("INSERT INTO items(title,file_path,file_format) VALUES ('Other','other.pdf','pdf')").run().lastInsertRowid);
    assert.equal((await post(30, { itemId: secondItem })).statusCode, 400);
    await setting(false); await post(120);
    assert.equal(db.prepare('SELECT seconds FROM reading_sessions WHERE id=?').get(id).seconds, 90);
    const report = (await app.inject(`/api/analytics?today=${day}&days=7`)).json();
    assert.equal(report.daily[0].seconds, 90);
    assert.equal(report.books[0].seconds, 90);
    assert.equal(report.books[0].title, 'Analytics fixture');
    assert.equal(report.streak, 1);
    assert.equal(report.notes.words, 0);
    const yesterday = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    db.prepare('INSERT INTO reading_sessions(id,item_id,day,seconds,started_at) VALUES(?,?,?,?,?)').run(randomUUID(), itemId, yesterday, 80, 0);
    assert.equal((await app.inject(`/api/analytics?today=${day}&days=all`)).json().streak, 2);
    db.prepare('DELETE FROM items WHERE id=?').run(itemId);
    assert.equal((await app.inject(`/api/analytics?today=${day}&days=all`)).json().books.length, 0);
  } finally { await app.close(); }
});
