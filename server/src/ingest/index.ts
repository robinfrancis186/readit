import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { COVER_DIR, LIBRARY_DIR } from '../config.js';
import { db } from '../db.js';
import { ensureDocuments } from '../documents.js';
import { parseEpub } from './epub.js';
import { parsePdf } from './pdf.js';
import type { ExtractedMetadata, ExtractedSection } from './types.js';

export type ItemKind = 'book' | 'magazine' | 'newspaper' | 'document';

export interface IngestOverrides {
  kind?: ItemKind;
  title?: string;
  subtitle?: string;
  authors?: string[];
  language?: string;
  publisher?: string;
  publishedDate?: string;
  edition?: string;
  genres?: string[];
  issueDate?: string;
  issueNumber?: string;
  volume?: string;
  series?: string;
}

export interface IngestResult {
  itemId: number;
  duplicate: boolean;
  title: string;
  sections: number;
}

function slug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase() || 'item';
}

/**
 * Periodicals are almost always filed as `the-hindu-2026-03-04.pdf`, so the
 * filename carries both the masthead and the issue date. Pull out each.
 */
export function parseFilename(filename: string): { title: string; issueDate?: string } {
  const stem = filename.replace(/\.[^.]+$/, '');

  const dateMatch = /(?:^|[^\d])(\d{4})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/.exec(stem);
  const issueDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : undefined;

  const words = stem
    .replace(/(\d{4})[-_.](\d{2})[-_.](\d{2})/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Only title-case when the name is clearly slug-ish; leave real prose alone.
  const title = /^[a-z0-9 ]+$/.test(words)
    ? words.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase())
    : words;

  return { title, issueDate };
}

/** A title like "Foo: The Hidden Business" splits into title + subtitle. */
function splitSubtitle(title: string): { title: string; subtitle?: string } {
  const idx = title.indexOf(': ');
  if (idx > 0 && idx < title.length - 2) {
    return { title: title.slice(0, idx).trim(), subtitle: title.slice(idx + 2).trim() };
  }
  return { title: title.trim() };
}

export async function ingestFile(
  filename: string,
  buffer: Buffer,
  overrides: IngestOverrides = {},
): Promise<IngestResult> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const existing = db.prepare('SELECT id, title FROM items WHERE sha256 = ?').get(sha256) as
    | { id: number; title: string }
    | undefined;
  if (existing) {
    return { itemId: existing.id, duplicate: true, title: existing.title, sections: 0 };
  }

  const ext = extname(filename).toLowerCase();
  let metadata: ExtractedMetadata;
  let sections: ExtractedSection[];
  let cover: { data: Buffer; ext: string } | undefined;
  let format: 'epub' | 'pdf';

  if (ext === '.epub') {
    format = 'epub';
    const parsed = parseEpub(buffer);
    metadata = parsed.metadata;
    sections = parsed.sections;
    cover = parsed.cover;
  } else if (ext === '.pdf') {
    format = 'pdf';
    const parsed = await parsePdf(buffer);
    metadata = parsed.metadata;
    sections = parsed.sections;
  } else {
    throw new Error(`Unsupported file type "${ext || filename}". Readit accepts .epub and .pdf.`);
  }

  // A PDF with no usable embedded title is better named after its file.
  const fromName = parseFilename(filename);
  if (/^untitled/i.test(metadata.title) && fromName.title) {
    metadata.title = fromName.title;
  }

  const merged = applyOverrides(metadata, overrides);
  const { title, subtitle } = overrides.title
    ? { title: overrides.title, subtitle: overrides.subtitle ?? merged.subtitle }
    : splitSubtitle(merged.title);

  const storedName = `${sha256.slice(0, 12)}-${slug(title)}${ext}`;
  const storedPath = join(LIBRARY_DIR, storedName);
  await writeFile(storedPath, buffer);

  let coverPath: string | null = null;
  if (cover) {
    const coverName = `${sha256.slice(0, 12)}.${cover.ext}`;
    await writeFile(join(COVER_DIR, coverName), cover.data);
    coverPath = coverName;
  }

  const kind = overrides.kind ?? inferKind(format, merged, filename);

  const insertItem = db.prepare(`
    INSERT INTO items (
      kind, title, subtitle, authors, language, publisher, published_date, year, edition,
      genres, isbn, series, issue_date, issue_number, volume, description, page_count,
      file_path, file_format, file_size, sha256, cover_path
    ) VALUES (
      @kind, @title, @subtitle, @authors, @language, @publisher, @published_date, @year, @edition,
      @genres, @isbn, @series, @issue_date, @issue_number, @volume, @description, @page_count,
      @file_path, @file_format, @file_size, @sha256, @cover_path
    )
  `);

  const insertText = db.prepare(`
    INSERT INTO item_text (item_id, section_index, section_href, section_title, text)
    VALUES (?, ?, ?, ?, ?)
  `);

  // One transaction: an item is either fully searchable or not in the library.
  const run = db.transaction(() => {
    const info = insertItem.run({
      kind,
      title,
      subtitle: subtitle ?? null,
      authors: JSON.stringify(merged.authors ?? []),
      language: merged.language ?? null,
      publisher: merged.publisher ?? null,
      published_date: merged.publishedDate ?? null,
      year: merged.year ?? null,
      edition: merged.edition ?? null,
      genres: JSON.stringify(merged.genres ?? []),
      isbn: merged.isbn ?? null,
      series: merged.series ?? null,
      // Issue date: what the user typed, else a date in the filename, else the
      // publication date — but only for periodicals, where an issue date means
      // something.
      issue_date:
        overrides.issueDate ??
        (kind === 'magazine' || kind === 'newspaper'
          ? fromName.issueDate ?? merged.publishedDate?.slice(0, 10) ?? null
          : null),
      issue_number: overrides.issueNumber ?? null,
      volume: overrides.volume ?? null,
      description: merged.description ?? null,
      page_count: merged.pageCount ?? (format === 'epub' ? null : sections.length),
      file_path: storedName,
      file_format: format,
      file_size: buffer.length,
      sha256,
      cover_path: coverPath,
    });
    const itemId = Number(info.lastInsertRowid);

    for (const s of sections) {
      insertText.run(itemId, s.index, s.href ?? null, s.title ?? null, s.text);
    }

    ensureDocuments(itemId);
    return itemId;
  });

  const itemId = run();
  return { itemId, duplicate: false, title, sections: sections.length };
}

function applyOverrides(base: ExtractedMetadata, o: IngestOverrides): ExtractedMetadata {
  const publishedDate = o.publishedDate ?? base.publishedDate;
  return {
    ...base,
    authors: o.authors?.length ? o.authors : base.authors,
    language: o.language ?? base.language,
    publisher: o.publisher ?? base.publisher,
    publishedDate,
    year: publishedDate ? Number(publishedDate.slice(0, 4)) || base.year : base.year,
    edition: o.edition ?? base.edition,
    genres: o.genres?.length ? o.genres : base.genres,
    series: o.series ?? base.series,
  };
}

/**
 * Guess whether this is a periodical so the excerpt notebook is dated by issue.
 * The user can always correct it on the item page.
 */
function inferKind(format: 'epub' | 'pdf', meta: ExtractedMetadata, filename: string): ItemKind {
  const haystack = `${meta.title} ${meta.genres.join(' ')} ${filename}`.toLowerCase();
  if (/\b(newspaper|daily|herald|times|tribune|gazette|express)\b/.test(haystack)) return 'newspaper';
  if (/\b(magazine|weekly|monthly|quarterly|journal|issue|vol\.?\s*\d)\b/.test(haystack)) return 'magazine';
  return format === 'pdf' && meta.authors.length === 0 ? 'document' : 'book';
}
