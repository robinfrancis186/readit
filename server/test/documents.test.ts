import './setup.js';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

const { db } = await import('../src/db.js');
const { documentRoutes } = await import('../src/routes/documents.js');

/**
 * The core "same word, same day" rule is covered in ingest.test.ts. These are
 * the edges around it: how words are compared, and what must *not* be
 * de-duplicated.
 */
let app: FastifyInstance;
let vocabDoc = 0;
let excerptDoc = 0;

before(async () => {
  app = Fastify();
  await app.register(documentRoutes);

  const item = db
    .prepare(
      `INSERT INTO items (kind, title, authors, genres, file_path, file_format, sha256)
       VALUES ('book', 'Dedup Edges', '[]', '[]', 'edges.epub', 'epub', 'sha-dedup-edges')`,
    )
    .run();
  const itemId = Number(item.lastInsertRowid);
  vocabDoc = Number(
    db.prepare("INSERT INTO documents (item_id, kind, title) VALUES (?, 'vocab', 'Words')").run(itemId)
      .lastInsertRowid,
  );
  excerptDoc = Number(
    db.prepare("INSERT INTO documents (item_id, kind, title) VALUES (?, 'excerpt', 'Notes')").run(itemId)
      .lastInsertRowid,
  );
});

async function addWord(word: string, readingDate: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/documents/${vocabDoc}/entries`,
    payload: { kind: 'word', text: word, word, readingDate },
  });
  return { status: res.statusCode, body: res.json() as { entry: { id: number }; duplicate?: boolean } };
}

describe('how saved words are compared', () => {
  it('ignores case and the punctuation a selection drags in', async () => {
    // Selecting a word in running text very often catches the comma or the
    // closing quote beside it; those must not create a second entry.
    const first = await addWord('Middleman', '2026-05-03');
    for (const variant of ['middleman', '“middleman,”', '  MIDDLEMAN.  ']) {
      const again = await addWord(variant, '2026-05-03');
      assert.equal(again.body.duplicate, true, `${variant} should match the saved word`);
      assert.equal(again.body.entry.id, first.body.entry.id);
    }
  });

  it('keeps Malayalam vowel signs when comparing', async () => {
    // \p{M} characters are not \p{L}: trimming naively turns ഭാഷയുടെ into
    // ഭാഷയുട, which would then wrongly match some other truncated form.
    const first = await addWord('ഭാഷയുടെ', '2026-05-04');
    const same = await addWord('ഭാഷയുടെ,', '2026-05-04');
    assert.equal(same.body.duplicate, true);
    assert.equal(same.body.entry.id, first.body.entry.id);
  });

  it('treats a different inflection as a different word', async () => {
    // Only an identical headword is a duplicate. A different surface form was
    // a genuinely different thing to have looked up.
    await addWord('ഭാഷ', '2026-05-05');
    const inflected = await addWord('ഭാഷയുടെ', '2026-05-05');
    assert.equal(inflected.body.duplicate, undefined);
  });
});

describe('what is never de-duplicated', () => {
  it('records the same passage twice — it may be quoted on purpose', async () => {
    const payload = { kind: 'excerpt', text: 'The same passage, twice.', readingDate: '2026-05-07' };
    const first = await app.inject({ method: 'POST', url: `/api/documents/${excerptDoc}/entries`, payload });
    const second = await app.inject({ method: 'POST', url: `/api/documents/${excerptDoc}/entries`, payload });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.notEqual(
      (first.json() as { entry: { id: number } }).entry.id,
      (second.json() as { entry: { id: number } }).entry.id,
    );
  });
});

describe('searching inside a notebook', () => {
  it('matches on keyword and narrows by date range', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/documents/${excerptDoc}/entries`,
      payload: { kind: 'excerpt', text: 'A distinctive phrase about vultures.', readingDate: '2026-06-01' },
    });

    const hit = await app.inject({ method: 'GET', url: `/api/documents/${excerptDoc}?q=distinctive` });
    assert.equal((hit.json() as { entries: unknown[] }).entries.length, 1);

    const outOfRange = await app.inject({
      method: 'GET',
      url: `/api/documents/${excerptDoc}?q=distinctive&from=2020-01-01&to=2020-12-31`,
    });
    assert.equal((outOfRange.json() as { entries: unknown[] }).entries.length, 0);

    const inRange = await app.inject({
      method: 'GET',
      url: `/api/documents/${excerptDoc}?from=2026-06-01&to=2026-06-01`,
    });
    assert.equal((inRange.json() as { entries: unknown[] }).entries.length, 1);
  });
});
