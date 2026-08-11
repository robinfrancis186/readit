import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { createPage, resolvePage, safeParseArray, today, touchDocument } from '../documents.js';
import { escapeHtml } from '../ingest/text.js';

const addEntry = z.object({
  kind: z.enum(['excerpt', 'word']).default('excerpt'),
  text: z.string().min(1),
  html: z.string().optional(),
  note: z.string().optional(),
  word: z.string().optional(),
  lang: z.string().optional(),
  meanings: z.unknown().optional(),
  dictSource: z.string().optional(),
  sourceLabel: z.string().optional(),
  sourceLocator: z.string().optional(),
  readingDate: z.string().optional(),
  issueDate: z.string().optional(),
  pageId: z.number().optional(),
});

const updateEntry = z.object({
  html: z.string().optional(),
  text: z.string().optional(),
  note: z.string().nullable().optional(),
  readingDate: z.string().optional(),
  issueDate: z.string().nullable().optional(),
  pageId: z.number().optional(),
  orderIndex: z.number().optional(),
});

const docQuery = z.object({
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  pageId: z.coerce.number().optional(),
});

function ftsQuery(raw: string): string {
  const tokens = raw.replace(/["*()^:]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' AND ') : '';
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * A document plus its pages and entries, filtered by keyword and/or date.
   * This single endpoint backs both the reading-notes and word-list views and
   * their search bars.
   */
  app.get('/api/documents/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const q = docQuery.parse(req.query);

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | { id: number; item_id: number; kind: string; title: string }
      | undefined;
    if (!doc) return reply.code(404).send({ error: 'Not found' });

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(doc.item_id) as
      | Record<string, any>
      | undefined;

    const where: string[] = ['e.document_id = ?'];
    const params: unknown[] = [id];

    if (q.q) {
      const match = ftsQuery(q.q);
      if (match) {
        where.push('e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)');
        params.push(match);
      }
    }
    // Dates match against the issue date when there is one (periodicals), else
    // the reading date — which is what "search by date" means in both notebooks.
    if (q.from) { where.push('COALESCE(e.issue_date, e.reading_date) >= ?'); params.push(q.from); }
    if (q.to) { where.push('COALESCE(e.issue_date, e.reading_date) <= ?'); params.push(q.to); }
    if (q.pageId) { where.push('e.page_id = ?'); params.push(q.pageId); }

    const entries = db
      .prepare(
        `SELECT e.* FROM entries e
          WHERE ${where.join(' AND ')}
          ORDER BY e.page_id ASC, e.order_index ASC, e.id ASC`,
      )
      .all(...params) as Array<Record<string, any>>;

    const pages = db
      .prepare('SELECT * FROM doc_pages WHERE document_id = ? ORDER BY page_number ASC')
      .all(id);

    return {
      document: doc,
      item: item ? { ...item, authors: safeParseArray(item.authors), genres: safeParseArray(item.genres) } : null,
      pages,
      entries: entries.map((e) => ({
        ...e,
        meanings: e.meanings ? JSON.parse(e.meanings) : null,
      })),
      filtered: Boolean(q.q || q.from || q.to || q.pageId),
    };
  });

  app.post('/api/documents/:id/entries', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = addEntry.parse(req.body);

    const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
    if (!doc) return reply.code(404).send({ error: 'No such document' });

    const readingDate = body.readingDate ?? today();
    const pageId = resolvePage(id, {
      issueDate: body.issueDate,
      readingDate,
      pageId: body.pageId,
    });

    const nextOrder = db
      .prepare('SELECT COALESCE(MAX(order_index), 0) + 1 AS n FROM entries WHERE page_id = ?')
      .get(pageId) as { n: number };

    const info = db
      .prepare(
        `INSERT INTO entries (
           document_id, page_id, kind, content_html, content_text, note, word, lang,
           meanings, dict_source, source_label, source_locator, reading_date, issue_date, order_index
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        pageId,
        body.kind,
        body.html ?? `<p>${escapeHtml(body.text)}</p>`,
        body.text,
        body.note ?? null,
        body.word ?? null,
        body.lang ?? null,
        body.meanings ? JSON.stringify(body.meanings) : null,
        body.dictSource ?? null,
        body.sourceLabel ?? null,
        body.sourceLocator ?? null,
        readingDate,
        body.issueDate ?? null,
        nextOrder.n,
      );

    touchDocument(id);
    const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(info.lastInsertRowid));
    return reply.code(201).send({ entry });
  });

  app.patch('/api/entries/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = updateEntry.parse(req.body);
    const existing = db.prepare('SELECT document_id FROM entries WHERE id = ?').get(id) as
      | { document_id: number }
      | undefined;
    if (!existing) return reply.code(404).send({ error: 'Not found' });

    const map: Record<string, unknown> = {
      content_html: body.html,
      content_text: body.text,
      note: body.note,
      reading_date: body.readingDate,
      issue_date: body.issueDate,
      page_id: body.pageId,
      order_index: body.orderIndex,
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [col, value] of Object.entries(map)) {
      if (value === undefined) continue;
      sets.push(`${col} = ?`);
      params.push(value);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      touchDocument(existing.document_id);
    }
    return { entry: db.prepare('SELECT * FROM entries WHERE id = ?').get(id) };
  });

  app.delete('/api/entries/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = db.prepare('SELECT document_id FROM entries WHERE id = ?').get(id) as
      | { document_id: number }
      | undefined;
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    touchDocument(existing.document_id);
    return { ok: true };
  });

  app.post('/api/documents/:id/pages', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = z
      .object({ title: z.string().optional(), issueDate: z.string().optional() })
      .parse(req.body ?? {});
    const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
    if (!doc) return reply.code(404).send({ error: 'No such document' });
    const pageId = createPage(id, { title: body.title, issueDate: body.issueDate ?? null });
    return reply.code(201).send({ page: db.prepare('SELECT * FROM doc_pages WHERE id = ?').get(pageId) });
  });

  app.patch('/api/pages/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = z
      .object({ title: z.string().optional(), issueDate: z.string().nullable().optional() })
      .parse(req.body ?? {});
    const existing = db.prepare('SELECT id FROM doc_pages WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    if (body.title !== undefined) db.prepare('UPDATE doc_pages SET title = ? WHERE id = ?').run(body.title, id);
    if (body.issueDate !== undefined) {
      db.prepare('UPDATE doc_pages SET issue_date = ? WHERE id = ?').run(body.issueDate, id);
    }
    return { page: db.prepare('SELECT * FROM doc_pages WHERE id = ?').get(id) };
  });

  app.delete('/api/pages/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = db.prepare('SELECT id FROM doc_pages WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    db.prepare('DELETE FROM doc_pages WHERE id = ?').run(id);
    return { ok: true };
  });

  /** Plain-text / Markdown export of a whole notebook. */
  app.get('/api/documents/:id/export', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | { id: number; title: string; kind: string }
      | undefined;
    if (!doc) return reply.code(404).send({ error: 'Not found' });

    const pages = db
      .prepare('SELECT * FROM doc_pages WHERE document_id = ? ORDER BY page_number')
      .all(id) as Array<{ id: number; page_number: number; title: string | null; issue_date: string | null }>;
    const entries = db
      .prepare('SELECT * FROM entries WHERE document_id = ? ORDER BY page_id, order_index, id')
      .all(id) as Array<Record<string, any>>;

    const lines: string[] = [`# ${doc.title}`, ''];
    for (const page of pages) {
      const pageEntries = entries.filter((e) => e.page_id === page.id);
      if (!pageEntries.length) continue;
      const heading = page.issue_date
        ? `${page.title ?? `Page ${page.page_number}`} (${page.issue_date})`
        : (page.title ?? `Page ${page.page_number}`);
      lines.push(`## ${heading}`, '');
      for (const e of pageEntries) {
        if (e.kind === 'word') {
          lines.push(`**${e.word}**${e.lang ? ` _(${e.lang})_` : ''}`);
          const meanings = e.meanings ? JSON.parse(e.meanings) : null;
          if (Array.isArray(meanings)) {
            for (const r of meanings) {
              for (const s of r.senses ?? []) {
                lines.push(`- ${s.pos ? `*${s.pos}* ` : ''}${s.definition} — ${r.source}`);
              }
            }
          }
        } else {
          lines.push(`> ${String(e.content_text).replace(/\n/g, '\n> ')}`);
          if (e.source_label) lines.push(`> — ${e.source_label}`);
        }
        if (e.note) lines.push('', `Note: ${e.note}`);
        lines.push('', `_Recorded ${e.reading_date}_`, '');
      }
    }

    return reply
      .type('text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="document-${id}.md"`)
      .send(lines.join('\n'));
  });
}
