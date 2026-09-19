import './setup.js';
import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import Fastify from 'fastify';
import { ZodError } from 'zod';
const { db } = await import('../src/db.js');
const { libraryDb } = await import('../src/library-db.js');
const { libraryRoutes } = await import('../src/routes/library.js');
const { documentRoutes } = await import('../src/routes/documents.js');
const { ensureDocuments } = await import('../src/documents.js');
const { searchDefinitions, insertEntries } = await import('../src/dictionary/index.js');
const { decodeEntities } = await import('../src/ingest/text.js');
const app = Fastify();
let itemId: number, notes: number, otherNotes: number, vocab: number;
before(async () => {
  app.setErrorHandler((err: any, _req, reply) => reply.code(err instanceof ZodError ? 400 : err.statusCode || 500).send({ error: err.message }));
  await app.register(libraryRoutes);
  await app.register(documentRoutes);
  const insert = db.prepare("INSERT INTO items (title, authors, genres, file_path, file_format, year, published_date) VALUES (?, ?, ?, 'fixture.pdf', 'pdf', 2024, '2024-01-01')");
  itemId = Number(insert.run('Exact author', '["Ann"]', '["Art"]' ).lastInsertRowid);
  const other = Number(insert.run('Substring author', '["Anna"]', '["Martial Arts"]' ).lastInsertRowid);
  ({ excerpt: notes, vocab } = await ensureDocuments(itemId));
  otherNotes = (await ensureDocuments(other)).excerpt;
  db.prepare('INSERT INTO item_text (item_id, section_index, text) VALUES (?, 0, ?)').run(itemId, '<img src=x onerror=alert(1)> unique passage');
});
after(() => app.close());
it('matches complete facet values and rejects fractional pagination', async () => {
  for (const query of ['author=Ann', 'genre=Art']) {
    const result = await app.inject(`/api/library?${query}`);
    assert.equal(result.json().total, 1);
    assert.equal(result.json().items[0].id, itemId);
  }
  assert.equal((await app.inject('/api/library?limit=1.5')).statusCode, 400);
});
it('returns safe highlighted snippets from hostile document text', async () => {
  const result = await app.inject(`/api/library/${itemId}/search?q=unique`);
  const snippet = result.json().hits[0].snippet;
  assert.ok(snippet.includes('<mark>unique</mark>'));
  assert.ok(!snippet.includes('<img'));
  assert.ok(snippet.includes('&lt;img'));
});
it('clears the derived year when publication date is removed', async () => {
  const result = await app.inject({ method: 'PATCH', url: `/api/library/${itemId}`, payload: { published_date: null } });
  assert.equal(result.json().item.year, null);
});
it('keeps notebook text safe and prevents cross-notebook moves', async () => {
  const created = await app.inject({ method: 'POST', url: `/api/documents/${notes}/entries`, payload: { text: '<img src=x onerror=alert(1)>', html: '<script>alert(1)</script>' } });
  assert.equal(created.statusCode, 201);
  assert.ok(!created.json().entry.content_html.includes('<script'));
  const page = await app.inject({ method: 'POST', url: `/api/documents/${otherNotes}/pages`, payload: {} });
  const pageId = page.json().page.id;
  const moved = await app.inject({ method: 'PATCH', url: `/api/entries/${created.json().entry.id}`, payload: { pageId } });
  assert.equal(moved.statusCode, 400);
  const invalid = await app.inject({ method: 'POST', url: `/api/documents/${notes}/entries`, payload: { text: 'Bad page', pageId } });
  assert.equal(invalid.statusCode, 400);
});
it('rejects malformed meaning shapes and filters vocabulary by reading date', async () => {
  const invalid = await app.inject({ method: 'POST', url: `/api/documents/${vocab}/entries`, payload: { text: 'word', meanings: 'not an array' } });
  assert.equal(invalid.statusCode, 400);
  await app.inject({ method: 'POST', url: `/api/documents/${vocab}/entries`, payload: { text: 'word', kind: 'word', readingDate: '2026-09-19', issueDate: '2020-01-01' } });
  assert.equal((await app.inject(`/api/documents/${vocab}?from=2026-09-19&to=2026-09-19`)).json().entries.length, 1);
});
it('treats punctuation as text in dictionary searches and bounds code points', () => {
  insertEntries([{ lang: 'en', headword: 'book', definition: 'reading material', source: 'regression' }]);
  for (const query of ['(', 'NOT', 'a:b', '"', '*', '-', 'reading OR']) assert.doesNotThrow(() => searchDefinitions(query, 'en'));
  assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
});
it('rolls back an asynchronous library transaction', async () => {
  await assert.rejects(libraryDb.transaction(async () => {
    await libraryDb.prepare("UPDATE items SET title = 'should roll back' WHERE id = ?").run(itemId);
    throw new Error('cancel');
  })());
  assert.equal(db.prepare('SELECT title FROM items WHERE id = ?').get(itemId) && (db.prepare('SELECT title FROM items WHERE id = ?').get(itemId) as any).title, 'Exact author');
});

it('paginates deterministically without losing the remaining items', async () => {
  const first = (await app.inject('/api/library?limit=1&offset=0')).json();
  const second = (await app.inject('/api/library?limit=1&offset=1')).json();
  assert.equal(first.total, 2);
  assert.equal(second.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
});
it('reads the self-contained EPUB fixture', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseEpub } = await import('../src/ingest/epub.js');
  const result = parseEpub(readFileSync(new URL('../../e2e/fixtures/reading-garden.epub', import.meta.url)));
  assert.equal(result.metadata.title, 'The Reading Garden');
  assert.equal(result.sections.length, 2);
  assert.match(result.sections[1].text, /Discovery/);
});
it('rejects oversized EPUB entries before decompression', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseEpub } = await import('../src/ingest/epub.js');
  const bytes = readFileSync(new URL('../../e2e/fixtures/reading-garden.epub', import.meta.url));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(33 * 1024 * 1024, central + 24);
  assert.throws(() => parseEpub(bytes), /expands beyond the supported size/);
});
