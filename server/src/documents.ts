import { db } from './db.js';

export type DocumentKind = 'excerpt' | 'vocab';

/** How many entries land on one page before a book-style document turns over. */
export const PAGE_CAPACITY = 12;

export interface ItemRow {
  id: number;
  kind: string;
  title: string;
  subtitle: string | null;
  authors: string;
  publisher: string | null;
  year: number | null;
  edition: string | null;
  issue_date: string | null;
  issue_number: string | null;
  language: string | null;
}

/**
 * The naming rule from the brief: every document is titled with the particulars
 * of the source — title, author, publisher, year, edition — so a document is
 * identifiable on its own, detached from the library.
 */
export function describeItem(item: ItemRow): string {
  const authors = safeParseArray(item.authors);
  const parts: string[] = [];
  const fullTitle = item.subtitle ? `${item.title}: ${item.subtitle}` : item.title;
  parts.push(fullTitle);
  if (authors.length) parts.push(authors.join(', '));
  if (item.edition) parts.push(item.edition);
  if (item.publisher) parts.push(item.publisher);
  if (item.issue_number) parts.push(`No. ${item.issue_number}`);
  if (item.issue_date) parts.push(item.issue_date);
  else if (item.year) parts.push(String(item.year));
  return parts.join(' — ');
}

export function safeParseArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Every item owns exactly one excerpt notebook and one vocabulary notebook. */
export function ensureDocuments(itemId: number): { excerpt: number; vocab: number } {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as ItemRow | undefined;
  if (!item) throw new Error(`No such item: ${itemId}`);

  const label = describeItem(item);
  const insert = db.prepare(`
    INSERT INTO documents (item_id, kind, title) VALUES (?, ?, ?)
    ON CONFLICT(item_id, kind) DO UPDATE SET title = excluded.title
  `);
  insert.run(itemId, 'excerpt', `Reading notes — ${label}`);
  insert.run(itemId, 'vocab', `Word list — ${label}`);

  const rows = db
    .prepare('SELECT id, kind FROM documents WHERE item_id = ?')
    .all(itemId) as Array<{ id: number; kind: DocumentKind }>;
  const byKind = Object.fromEntries(rows.map((r) => [r.kind, r.id])) as Record<DocumentKind, number>;
  return { excerpt: byKind.excerpt, vocab: byKind.vocab };
}

export interface ResolvePageOptions {
  /** For periodicals: the publication date of the issue being read. */
  issueDate?: string | null;
  /** For word lists: the date the reading happened. */
  readingDate?: string | null;
  /** Force a specific existing page. */
  pageId?: number | null;
}

/**
 * Decide which page a new entry belongs on.
 *
 * - Periodical excerpt notebooks and every word list are grouped by date, so
 *   entries from one issue (or one day's reading) stay together and the pages
 *   run chronologically.
 * - Book excerpt notebooks simply fill pages in order, like a real notebook.
 */
export function resolvePage(documentId: number, opts: ResolvePageOptions = {}): number {
  if (opts.pageId) {
    const found = db
      .prepare('SELECT id FROM doc_pages WHERE id = ? AND document_id = ?')
      .get(opts.pageId, documentId) as { id: number } | undefined;
    if (found) return found.id;
  }

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as
    | { id: number; item_id: number; kind: DocumentKind }
    | undefined;
  if (!doc) throw new Error(`No such document: ${documentId}`);

  const item = db.prepare('SELECT kind FROM items WHERE id = ?').get(doc.item_id) as
    | { kind: string }
    | undefined;

  const isPeriodical = item?.kind === 'magazine' || item?.kind === 'newspaper';
  const groupDate = doc.kind === 'vocab'
    ? opts.readingDate ?? today()
    : isPeriodical
      ? opts.issueDate ?? opts.readingDate ?? today()
      : null;

  if (groupDate) {
    const existing = db
      .prepare('SELECT id FROM doc_pages WHERE document_id = ? AND issue_date = ?')
      .get(documentId, groupDate) as { id: number } | undefined;
    if (existing) return existing.id;
    return createPage(documentId, {
      issueDate: groupDate,
      title: doc.kind === 'vocab' ? `Words — ${groupDate}` : `Issue of ${groupDate}`,
    });
  }

  // Sequential book-style paging.
  const last = db
    .prepare('SELECT id, page_number FROM doc_pages WHERE document_id = ? ORDER BY page_number DESC LIMIT 1')
    .get(documentId) as { id: number; page_number: number } | undefined;

  if (!last) return createPage(documentId, { title: 'Page 1' });

  const count = db
    .prepare('SELECT COUNT(*) AS n FROM entries WHERE page_id = ?')
    .get(last.id) as { n: number };
  if (count.n < PAGE_CAPACITY) return last.id;

  return createPage(documentId, { title: `Page ${last.page_number + 1}` });
}

export function createPage(
  documentId: number,
  opts: { title?: string; issueDate?: string | null } = {},
): number {
  const next = db
    .prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM doc_pages WHERE document_id = ?')
    .get(documentId) as { n: number };
  const info = db
    .prepare('INSERT INTO doc_pages (document_id, page_number, title, issue_date) VALUES (?, ?, ?, ?)')
    .run(documentId, next.n, opts.title ?? `Page ${next.n}`, opts.issueDate ?? null);
  return Number(info.lastInsertRowid);
}

export function touchDocument(documentId: number): void {
  db.prepare("UPDATE documents SET updated_at = datetime('now') WHERE id = ?").run(documentId);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
