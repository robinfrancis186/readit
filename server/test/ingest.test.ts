import './setup.js';
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const { ingestFile, parseFilename } = await import('../src/ingest/index.js');
const { cleanPdfTitle } = await import('../src/ingest/pdf.js');
const { htmlToText } = await import('../src/ingest/text.js');
const { db } = await import('../src/db.js');
const { resolvePage, describeItem, PAGE_CAPACITY } = await import('../src/documents.js');

/** The sample book lives outside the repo; these tests skip without it. */
const SAMPLE = process.env.READIT_SAMPLE_EPUB ?? '';
const hasSample = SAMPLE && existsSync(SAMPLE);

describe('htmlToText', () => {
  it('keeps paragraph breaks and drops markup', () => {
    // Paragraphs are separated by a blank line; a <br> is a single newline.
    const out = htmlToText('<p>One</p><p>Two<br/>Three</p><script>ignore()</script>');
    assert.equal(out, 'One\n\nTwo\nThree');
  });

  it('decodes named and numeric entities', () => {
    assert.equal(htmlToText('<p>a &amp; b &#8212; c &mdash; d &#x2019;e</p>'), 'a & b — c — d ’e');
  });
});

describe('cleanPdfTitle', () => {
  it('keeps a real title', () => {
    assert.equal(cleanPdfTitle('The Hidden Business of Democracy'), 'The Hidden Business of Democracy');
  });

  it('rejects the junk authoring tools leave behind', () => {
    for (const junk of ['', '   ', 'Untitled', 'untitled document', 'about:blank', 'https://example.com/x', 'Document', 'Slide 1', '2f8a91bc-4d3e-11ee-9c11', '12345']) {
      assert.equal(cleanPdfTitle(junk), '', `expected "${junk}" to be rejected`);
    }
  });

  it('unwraps a filename left by the authoring tool', () => {
    assert.equal(cleanPdfTitle('Microsoft Word - Annual Report.doc'), 'Annual Report');
    assert.equal(cleanPdfTitle('minutes.pdf'), 'minutes');
  });
});

describe('parseFilename', () => {
  it('pulls the masthead and issue date out of a periodical filename', () => {
    assert.deepEqual(parseFilename('kerala-chronicle-2026-03-04.pdf'), {
      title: 'Kerala Chronicle',
      issueDate: '2026-03-04',
    });
  });

  it('handles underscores and a leading date', () => {
    assert.deepEqual(parseFilename('2026_01_09_the_daily_star.pdf'), {
      title: 'The Daily Star',
      issueDate: '2026-01-09',
    });
  });

  it('leaves real prose alone rather than title-casing it', () => {
    assert.deepEqual(parseFilename('A Feast of Vultures.epub'), {
      title: 'A Feast of Vultures',
      issueDate: undefined,
    });
  });

  it('reports no date when there is none', () => {
    assert.equal(parseFilename('notes.pdf').issueDate, undefined);
  });
});

describe('describeItem', () => {
  it('names a document with the full particulars of its source', () => {
    const label = describeItem({
      id: 1,
      kind: 'book',
      title: 'A Feast of Vultures',
      subtitle: 'The Hidden Business of Democracy in India',
      authors: JSON.stringify(['Josy Joseph']),
      publisher: 'HarperCollins India',
      year: 2016,
      edition: null,
      issue_date: null,
      issue_number: null,
      language: 'en',
    });
    assert.equal(
      label,
      'A Feast of Vultures: The Hidden Business of Democracy in India — Josy Joseph — HarperCollins India — 2016',
    );
  });

  it('uses the issue date for a periodical', () => {
    const label = describeItem({
      id: 2,
      kind: 'newspaper',
      title: 'Mathrubhumi',
      subtitle: null,
      authors: '[]',
      publisher: null,
      year: 2026,
      edition: null,
      issue_date: '2026-03-04',
      issue_number: '61',
      language: 'ml',
    });
    assert.equal(label, 'Mathrubhumi — No. 61 — 2026-03-04');
  });
});

describe('EPUB ingestion', { skip: hasSample ? false : 'set READIT_SAMPLE_EPUB to run' }, () => {
  let itemId = 0;

  before(async () => {
    const res = await ingestFile('A_Feast_of_Vultures.epub', readFileSync(SAMPLE));
    itemId = res.itemId;
  });

  it('reads Dublin Core metadata off the OPF', () => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Record<string, any>;
    assert.equal(item.title, 'A Feast of Vultures');
    assert.equal(item.subtitle, 'The Hidden Business of Democracy in India');
    assert.deepEqual(JSON.parse(item.authors), ['Josy Joseph']);
    assert.equal(item.publisher, 'HarperCollins India');
    assert.equal(item.language, 'en');
    assert.equal(item.year, 2016);
    assert.equal(item.file_format, 'epub');
  });

  it('extracts the spine into searchable sections', () => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM item_text WHERE item_id = ?').get(itemId) as { n: number };
    assert.ok(n > 10, `expected many sections, got ${n}`);
  });

  it('indexes the text for in-book keyword search', () => {
    const hits = db
      .prepare(
        `SELECT t.section_title FROM item_text_fts f JOIN item_text t ON t.id = f.rowid
          WHERE item_text_fts MATCH ? AND t.item_id = ? LIMIT 5`,
      )
      .all('"corruption"*', itemId);
    assert.ok(hits.length > 0, 'expected hits for "corruption"');
  });

  it('creates both notebooks, titled with the book particulars', () => {
    const docs = db
      .prepare('SELECT kind, title FROM documents WHERE item_id = ? ORDER BY kind')
      .all(itemId) as Array<{ kind: string; title: string }>;
    assert.deepEqual(docs.map((d) => d.kind), ['excerpt', 'vocab']);
    assert.match(docs[0].title, /^Reading notes — A Feast of Vultures/);
    assert.match(docs[1].title, /^Word list — A Feast of Vultures/);
    assert.match(docs[0].title, /Josy Joseph — HarperCollins India — 2016$/);
  });

  it('refuses to store the same file twice', async () => {
    const again = await ingestFile('duplicate.epub', readFileSync(SAMPLE));
    assert.equal(again.duplicate, true);
    assert.equal(again.itemId, itemId);
  });

  it('rejects unsupported formats', async () => {
    await assert.rejects(
      () => ingestFile('notes.txt', Buffer.from('hello')),
      /Unsupported file type/,
    );
  });
});

describe('document paging', () => {
  function makeItem(kind: string, title: string): { itemId: number; excerpt: number; vocab: number } {
    const info = db
      .prepare(
        `INSERT INTO items (kind, title, authors, genres, file_path, file_format, sha256)
         VALUES (?, ?, '[]', '[]', ?, 'pdf', ?)`,
      )
      .run(kind, title, `${title}.pdf`, `sha-${title}-${Math.random()}`);
    const itemId = Number(info.lastInsertRowid);
    const ids = db
      .prepare("INSERT INTO documents (item_id, kind, title) VALUES (?, 'excerpt', ?)")
      .run(itemId, `Reading notes — ${title}`);
    const vocab = db
      .prepare("INSERT INTO documents (item_id, kind, title) VALUES (?, 'vocab', ?)")
      .run(itemId, `Word list — ${title}`);
    return { itemId, excerpt: Number(ids.lastInsertRowid), vocab: Number(vocab.lastInsertRowid) };
  }

  it('groups newspaper excerpts by issue date, one page per issue', () => {
    const { excerpt } = makeItem('newspaper', 'Daily Chronicle');
    const mar4 = resolvePage(excerpt, { issueDate: '2026-03-04' });
    const mar4again = resolvePage(excerpt, { issueDate: '2026-03-04' });
    const mar5 = resolvePage(excerpt, { issueDate: '2026-03-05' });

    assert.equal(mar4, mar4again, 'same issue must reuse its page');
    assert.notEqual(mar4, mar5, 'a new issue starts a new page');

    const pages = db
      .prepare('SELECT issue_date, page_number FROM doc_pages WHERE document_id = ? ORDER BY page_number')
      .all(excerpt);
    assert.deepEqual(pages, [
      { issue_date: '2026-03-04', page_number: 1 },
      { issue_date: '2026-03-05', page_number: 2 },
    ]);
  });

  it('fills book excerpt pages in order and turns over when full', () => {
    const { excerpt } = makeItem('book', 'Some Book');
    const first = resolvePage(excerpt);
    const insert = db.prepare(
      "INSERT INTO entries (document_id, page_id, kind, content_text) VALUES (?, ?, 'excerpt', 'x')",
    );
    for (let i = 0; i < PAGE_CAPACITY; i++) insert.run(excerpt, first);

    const second = resolvePage(excerpt);
    assert.notEqual(second, first, 'page should turn over once full');
    assert.equal(resolvePage(excerpt), second, 'and then keep filling the new page');
  });

  it('groups word lists by reading date regardless of item kind', () => {
    const { vocab } = makeItem('book', 'Another Book');
    const day1 = resolvePage(vocab, { readingDate: '2026-01-10' });
    const day1again = resolvePage(vocab, { readingDate: '2026-01-10' });
    const day2 = resolvePage(vocab, { readingDate: '2026-01-11' });

    assert.equal(day1, day1again);
    assert.notEqual(day1, day2);
    const page = db.prepare('SELECT title, issue_date FROM doc_pages WHERE id = ?').get(day1);
    assert.deepEqual(page, { title: 'Words — 2026-01-10', issue_date: '2026-01-10' });
  });
});
