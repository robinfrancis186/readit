import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './config.js';

export const DB_PATH = join(DATA_DIR, 'readit.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema notes
 *
 * `items`      one row per physical thing in the library: a book, a magazine
 *              issue, a newspaper issue, a loose PDF. Periodical-specific
 *              columns (issue_date, issue_number, volume) stay null for books.
 * `item_text`  the extracted plain text of an item, one row per section
 *              (EPUB spine entry / PDF page). Drives in-book search and lets
 *              excerpts record where they came from.
 * `documents`  the per-item editable documents. Every item gets exactly two:
 *              an `excerpt` notebook and a `vocab` notebook.
 * `doc_pages`  documents are paginated like a book. For periodicals a page is
 *              pinned to the issue date so a running title reads chronologically.
 * `entries`    a single excerpt or looked-up word inside a document page.
 * `dict_entries` the local dictionary store, filled by the importer scripts.
 *
 * All the *_fts tables are contentless-external FTS5 indexes kept in sync by
 * triggers, which is what powers the keyword search in the library, inside a
 * book, and inside the editable documents.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL DEFAULT 'book',   -- book | magazine | newspaper | document
  title            TEXT NOT NULL,
  subtitle         TEXT,
  authors          TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  language         TEXT,                           -- BCP-47-ish: en, ml, ...
  publisher        TEXT,
  published_date   TEXT,                           -- ISO-8601, may be partial (YYYY / YYYY-MM)
  year             INTEGER,
  edition          TEXT,
  genres           TEXT NOT NULL DEFAULT '[]',     -- JSON array of strings
  isbn             TEXT,
  series           TEXT,
  issue_date       TEXT,                           -- periodicals: date of this issue
  issue_number     TEXT,
  volume           TEXT,
  description      TEXT,
  page_count       INTEGER,
  file_path        TEXT NOT NULL,
  file_format      TEXT NOT NULL,                  -- epub | pdf
  file_size        INTEGER,
  sha256           TEXT UNIQUE,
  cover_path       TEXT,
  reading_progress REAL NOT NULL DEFAULT 0,
  reading_locator  TEXT,                           -- EPUB CFI or PDF page number
  added_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_kind       ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_language   ON items(language);
CREATE INDEX IF NOT EXISTS idx_items_year       ON items(year);
CREATE INDEX IF NOT EXISTS idx_items_publisher  ON items(publisher);
CREATE INDEX IF NOT EXISTS idx_items_issue_date ON items(issue_date);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title, subtitle, authors, publisher, genres, series, description,
  content='items', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, subtitle, authors, publisher, genres, series, description)
  VALUES (new.id, new.title, new.subtitle, new.authors, new.publisher, new.genres, new.series, new.description);
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, subtitle, authors, publisher, genres, series, description)
  VALUES ('delete', old.id, old.title, old.subtitle, old.authors, old.publisher, old.genres, old.series, old.description);
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, subtitle, authors, publisher, genres, series, description)
  VALUES ('delete', old.id, old.title, old.subtitle, old.authors, old.publisher, old.genres, old.series, old.description);
  INSERT INTO items_fts(rowid, title, subtitle, authors, publisher, genres, series, description)
  VALUES (new.id, new.title, new.subtitle, new.authors, new.publisher, new.genres, new.series, new.description);
END;

CREATE TABLE IF NOT EXISTS item_text (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  section_index INTEGER NOT NULL,
  section_href  TEXT,
  section_title TEXT,
  text          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_text_item ON item_text(item_id);

CREATE VIRTUAL TABLE IF NOT EXISTS item_text_fts USING fts5(
  text, content='item_text', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS item_text_ai AFTER INSERT ON item_text BEGIN
  INSERT INTO item_text_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS item_text_ad AFTER DELETE ON item_text BEGIN
  INSERT INTO item_text_fts(item_text_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                        -- excerpt | vocab
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, kind)
);

CREATE TABLE IF NOT EXISTS doc_pages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  title       TEXT,
  issue_date  TEXT,                                -- periodicals: the issue this page covers
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(document_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_doc_pages_doc ON doc_pages(document_id);

CREATE TABLE IF NOT EXISTS entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id        INTEGER NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,                    -- excerpt | word
  content_html   TEXT NOT NULL DEFAULT '',
  content_text   TEXT NOT NULL DEFAULT '',
  note           TEXT,
  word           TEXT,                             -- kind='word': the looked-up headword/phrase
  lang           TEXT,
  meanings       TEXT,                             -- JSON: dictionary results captured at save time
  dict_source    TEXT,
  source_label   TEXT,                             -- human readable: "Chapter 3" / "p. 42"
  source_locator TEXT,                             -- EPUB CFI or PDF page for jumping back
  reading_date   TEXT NOT NULL DEFAULT (date('now')),
  issue_date     TEXT,
  order_index    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_doc  ON entries(document_id);
CREATE INDEX IF NOT EXISTS idx_entries_page ON entries(page_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(reading_date);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  content_text, word, note, source_label,
  content='entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, content_text, word, note, source_label)
  VALUES (new.id, new.content_text, new.word, new.note, new.source_label);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, content_text, word, note, source_label)
  VALUES ('delete', old.id, old.content_text, old.word, old.note, old.source_label);
END;
CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, content_text, word, note, source_label)
  VALUES ('delete', old.id, old.content_text, old.word, old.note, old.source_label);
  INSERT INTO entries_fts(rowid, content_text, word, note, source_label)
  VALUES (new.id, new.content_text, new.word, new.note, new.source_label);
END;

CREATE TABLE IF NOT EXISTS dict_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lang          TEXT NOT NULL,                     -- ml | en
  source        TEXT NOT NULL,                     -- sabdatharavali | wordnet | ...
  headword      TEXT NOT NULL,
  headword_norm TEXT NOT NULL,                     -- lowercased/normalised lookup key
  pos           TEXT,
  definition    TEXT NOT NULL,
  examples      TEXT,
  raw_html      TEXT
);
CREATE INDEX IF NOT EXISTS idx_dict_norm ON dict_entries(headword_norm, lang);
CREATE INDEX IF NOT EXISTS idx_dict_src  ON dict_entries(source);

CREATE VIRTUAL TABLE IF NOT EXISTS dict_fts USING fts5(
  headword, definition, content='dict_entries', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS dict_ai AFTER INSERT ON dict_entries BEGIN
  INSERT INTO dict_fts(rowid, headword, definition) VALUES (new.id, new.headword, new.definition);
END;
CREATE TRIGGER IF NOT EXISTS dict_ad AFTER DELETE ON dict_entries BEGIN
  INSERT INTO dict_fts(dict_fts, rowid, headword, definition) VALUES ('delete', old.id, old.headword, old.definition);
END;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function migrate(): void {
  db.exec(SCHEMA);
}

migrate();
