import { escapeHtml } from '../ingest/text.js';
import { ftsQuery } from '../search.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '../config.js';
import { cloudStorage, readFileStream, removeFile, readUpload } from '../storage.js';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { libraryDb as db } from '../library-db.js';
import { ensureDocuments, safeParseArray } from '../documents.js';
import { ingestFile, type IngestOverrides, type ItemKind } from '../ingest/index.js';

const KINDS = ['book', 'magazine', 'newspaper', 'document'] as const;

const listQuery = z.object({
  q: z.string().optional(),
  kind: z.string().optional(),
  language: z.string().optional(),
  author: z.string().optional(),
  genre: z.string().optional(),
  publisher: z.string().optional(),
  series: z.string().optional(),
  yearFrom: z.coerce.number().optional(),
  yearTo: z.coerce.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sort: z.enum(['recent', 'title', 'author', 'year', 'opened']).default('recent'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

const patchBody = z.object({
  kind: z.enum(KINDS).optional(),
  title: z.string().min(1).optional(),
  subtitle: z.string().nullable().optional(),
  authors: z.array(z.string()).optional(),
  language: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  published_date: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  edition: z.string().nullable().optional(),
  genres: z.array(z.string()).optional(),
  isbn: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  issue_number: z.string().nullable().optional(),
  volume: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  reading_progress: z.number().min(0).max(1).optional(),
  reading_locator: z.string().nullable().optional(),
});

interface ItemRecord {
  id: number;
  authors: string;
  genres: string;
  [key: string]: unknown;
}

function shape(row: ItemRecord) {
  return {
    ...row,
    authors: safeParseArray(row.authors),
    genres: safeParseArray(row.genres),
  };
}

/** Turn user input into an FTS5 prefix query without letting syntax leak through. */

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/library/storage', async () => ({ cloud: cloudStorage, maxUploadBytes: MAX_UPLOAD_BYTES }));
  app.post('/api/library/upload-token', async (req, reply) => {
    if (!cloudStorage) return reply.code(404).send({ error: 'Cloud uploads are not enabled.' });
    return handleUpload({
      request: req.raw,
      body: req.body as HandleUploadBody,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^uploads\/[a-f0-9-]{36}\.(epub|pdf)$/.test(pathname)) {
          throw Object.assign(new Error('Invalid upload path.'), { statusCode: 400 });
        }
        return {
          allowedContentTypes: ['application/pdf', 'application/epub+zip', 'application/octet-stream'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          addRandomSuffix: true,
          allowOverwrite: false,
        };
      },
    });
  });
  app.post('/api/library/import', async (req, reply) => {
    if (!cloudStorage) return reply.code(404).send({ error: 'Cloud uploads are not enabled.' });
    const body = z.object({
      pathname: z.string().regex(/^uploads\/[a-f0-9-]{36}-[a-zA-Z0-9]+\.(epub|pdf)$/),
      filename: z.string().min(1).max(255).regex(/\.(epub|pdf)$/i),
      overrides: z.object({
        kind: z.enum(KINDS).optional(), title: z.string().max(1000).optional(),
        language: z.string().max(30).optional(), edition: z.string().max(100).optional(),
        issueDate: z.string().date().optional(), issueNumber: z.string().max(100).optional(),
        genres: z.array(z.string().max(100)).max(100).optional(),
      }).default({}),
    }).parse(req.body);
    // Only this store's pathnames are accepted; never fetch a client-supplied URL.
    const prior = await db.prepare('SELECT id, title FROM items WHERE file_path = ?').get(body.pathname);
    if (prior) return { results: [{ itemId: prior.id, title: prior.title, duplicate: true }] };
    try {
      const result = await ingestFile(body.filename, await readUpload(body.pathname), body.overrides, body.pathname);
      if (result.duplicate && !await db.prepare('SELECT id FROM items WHERE file_path = ?').get(body.pathname)) {
        await removeFile('library', body.pathname);
      }
      return { results: [result] };
    } catch (error) {
      // Retain a staged upload on failure so it can be retried without data loss.
      throw error;
    }
  });

  app.post('/api/library/upload', async (req, reply) => {
    const parts = req.parts();
    const overrides: IngestOverrides = {};
    const results = [];

    for await (const part of parts) {
      if (part.type === 'field') {
        const value = String(part.value ?? '').trim();
        if (!value) continue;
        switch (part.fieldname) {
          case 'kind':
            if ((KINDS as readonly string[]).includes(value)) overrides.kind = value as ItemKind;
            break;
          case 'authors':
          case 'genres': {
            const list = value.split(',').map((s) => s.trim()).filter(Boolean);
            if (part.fieldname === 'authors') overrides.authors = list;
            else overrides.genres = list;
            break;
          }
          case 'language': overrides.language = value; break;
          case 'publisher': overrides.publisher = value; break;
          case 'publishedDate': overrides.publishedDate = value; break;
          case 'edition': overrides.edition = value; break;
          case 'issueDate': overrides.issueDate = value; break;
          case 'issueNumber': overrides.issueNumber = value; break;
          case 'volume': overrides.volume = value; break;
          case 'series': overrides.series = value; break;
          case 'title': overrides.title = value; break;
        }
      } else if (part.type === 'file') {
        const buffer = await part.toBuffer();
        try {
          results.push(await ingestFile(part.filename, buffer, overrides));
        } catch (err) {
          results.push({ filename: part.filename, error: (err as Error).message });
        }
      }
    }

    if (!results.length) return reply.code(400).send({ error: 'No file was uploaded.' });
    return { results };
  });

  app.get('/api/library', async (req) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];

    if (q.q) {
      const match = ftsQuery(q.q);
      if (match) {
        where.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
        params.push(match);
      }
    }
    if (q.kind) { where.push('i.kind = ?'); params.push(q.kind); }
    if (q.language) { where.push('i.language = ?'); params.push(q.language); }
    if (q.publisher) { where.push('i.publisher = ?'); params.push(q.publisher); }
    if (q.series) { where.push('i.series = ?'); params.push(q.series); }
    if (q.author) { where.push('EXISTS (SELECT 1 FROM json_each(i.authors) WHERE value = ?)'); params.push(q.author); }
    if (q.genre) { where.push('EXISTS (SELECT 1 FROM json_each(i.genres) WHERE value = ?)'); params.push(q.genre); }
    if (q.yearFrom !== undefined) { where.push('i.year >= ?'); params.push(q.yearFrom); }
    if (q.yearTo !== undefined) { where.push('i.year <= ?'); params.push(q.yearTo); }
    if (q.dateFrom) { where.push('COALESCE(i.issue_date, i.published_date) >= ?'); params.push(q.dateFrom); }
    if (q.dateTo) { where.push('COALESCE(i.issue_date, i.published_date) <= ?'); params.push(q.dateTo); }

    const orderBy = {
      recent: 'i.added_at DESC, i.id DESC',
      title: 'i.title COLLATE NOCASE ASC',
      author: 'i.authors COLLATE NOCASE ASC, i.title COLLATE NOCASE ASC',
      year: 'COALESCE(i.issue_date, i.published_date, i.year) DESC',
      opened: 'i.last_opened_at DESC NULLS LAST',
    }[q.sort];

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = (await db
      .prepare(`SELECT i.* FROM items i ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, q.limit, q.offset)) as ItemRecord[];
    const total = (await db
      .prepare(`SELECT COUNT(*) AS n FROM items i ${clause}`)
      .get(...params)) as { n: number };

    return { items: rows.map(shape), total: total.n, limit: q.limit, offset: q.offset };
  });

  /** Distinct values for every facet, so the sidebar reflects what's actually there. */
  app.get('/api/library/facets', async () => {
    const scalar = async (col: string) =>
      ((await db
        .prepare(
          `SELECT ${col} AS value, COUNT(*) AS count FROM items
            WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY count DESC, value ASC`,
        )
        .all()) as Array<{ value: string; count: number }>);

    const jsonFacet = async (col: string) => {
      const counts = new Map<string, number>();
      const rows = (await db.prepare(`SELECT ${col} AS raw FROM items`).all()) as Array<{ raw: string }>;
      for (const row of rows) {
        for (const v of safeParseArray(row.raw)) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };

    const years = (await db
      .prepare('SELECT MIN(year) AS min, MAX(year) AS max FROM items WHERE year IS NOT NULL')
      .get()) as { min: number | null; max: number | null };

    return {
      kinds: await scalar('kind'),
      languages: await scalar('language'),
      publishers: await scalar('publisher'),
      series: await scalar('series'),
      authors: await jsonFacet('authors'),
      genres: await jsonFacet('genres'),
      years,
    };
  });

  app.get('/api/library/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = (await db.prepare('SELECT * FROM items WHERE id = ?').get(id)) as ItemRecord | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });

    const documents = (await db
      .prepare('SELECT id, kind, title, created_at, updated_at FROM documents WHERE item_id = ?')
      .all(id));
    const sections = (await db
      .prepare(
        'SELECT id, section_index, section_href, section_title, LENGTH(text) AS length FROM item_text WHERE item_id = ? ORDER BY section_index',
      )
      .all(id));
    const counts = (await db
      .prepare(
        `SELECT d.kind, COUNT(e.id) AS n FROM documents d
           LEFT JOIN entries e ON e.document_id = d.id
          WHERE d.item_id = ? GROUP BY d.kind`,
      )
      .all(id)) as Array<{ kind: string; n: number }>;

    return {
      item: shape(row),
      documents,
      sections,
      entryCounts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
    };
  });

  app.patch('/api/library/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = patchBody.parse(req.body);
    const exists = (await db.prepare('SELECT id FROM items WHERE id = ?').get(id));
    if (!exists) return reply.code(404).send({ error: 'Not found' });

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
    // Keep `year` consistent when only the full date was edited.
    if (body.published_date !== undefined && body.year === undefined) {
      const derived = body.published_date ? Number(body.published_date.slice(0, 4)) : null;
      sets.push('year = ?'); params.push(derived && Number.isFinite(derived) ? derived : null);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      (await db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id));
      // Document titles embed the item's particulars, so refresh them.
      await ensureDocuments(id);
    }

    return { item: shape((await db.prepare('SELECT * FROM items WHERE id = ?').get(id)) as ItemRecord) };
  });

  app.delete('/api/library/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = (await db.prepare('SELECT file_path, cover_path FROM items WHERE id = ?').get(id)) as
      | { file_path: string; cover_path: string | null }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });

    (await db.prepare('DELETE FROM items WHERE id = ?').run(id));
    await removeFile('library', row.file_path).catch((error) => app.log.error(error, 'File cleanup failed'));
    if (row.cover_path) await removeFile('covers', row.cover_path).catch((error) => app.log.error(error, 'Cover cleanup failed'));
    return { ok: true };
  });

  /** The raw EPUB/PDF, streamed to the reader in the browser. */
  app.get('/api/library/:id/file', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = (await db.prepare('SELECT file_path, file_format FROM items WHERE id = ?').get(id)) as
      | { file_path: string; file_format: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'Not found' });

    const stream = await readFileStream('library', row.file_path);
    if (!stream) return reply.code(410).send({ error: 'File is missing from storage' });

    (await db.prepare("UPDATE items SET last_opened_at = datetime('now') WHERE id = ?").run(id));
    return reply
      .type(row.file_format === 'pdf' ? 'application/pdf' : 'application/epub+zip')
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_path)}"`)
      .send(stream);
  });

  app.get('/api/library/:id/cover', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = (await db.prepare('SELECT cover_path FROM items WHERE id = ?').get(id)) as
      | { cover_path: string | null }
      | undefined;
    if (!row?.cover_path) return reply.code(404).send({ error: 'No cover' });
    const stream = await readFileStream('covers', row.cover_path);
    if (!stream) return reply.code(404).send({ error: 'No cover' });
    const ext = row.cover_path.split('.').pop();
    return reply
      .type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .send(stream);
  });

  /** Keyword search *inside* one item, returning snippets per section. */
  app.get('/api/library/:id/search', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const { q } = z.object({ q: z.string().min(1) }).parse(req.query);
    const match = ftsQuery(q);
    if (!match) return { hits: [] };

    const hits = (await db
      .prepare(
        `SELECT t.id, t.section_index, t.section_href, t.section_title,
                snippet(item_text_fts, 0, char(1), char(2), '…', 24) AS snippet
           FROM item_text_fts f
           JOIN item_text t ON t.id = f.rowid
          WHERE item_text_fts MATCH ? AND t.item_id = ?
          ORDER BY rank
          LIMIT 60`,
      )
      .all(match, id));
    return { hits: hits.map((hit) => ({ ...hit, snippet: escapeHtml(String(hit.snippet)).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>') })) };
  });

  /** Full text of one section — used to show excerpt context. */
  app.get('/api/library/:id/section/:index', async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const row = (await db
      .prepare('SELECT * FROM item_text WHERE item_id = ? AND section_index = ?')
      .get(Number(id), Number(index)));
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return row;
  });
}
