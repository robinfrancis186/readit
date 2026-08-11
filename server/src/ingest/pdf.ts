import type { ExtractedMetadata, ExtractedSection } from './types.js';

export interface PdfParseResult {
  metadata: ExtractedMetadata;
  sections: ExtractedSection[];
}

/**
 * pdf.js ships an ESM "legacy" build that runs under plain Node (no DOM). It is
 * loaded lazily because pulling it in costs ~1s of startup we don't want on
 * every server boot.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** PDF date strings look like `D:20160709183000+05'30'`. */
function parsePdfDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?/.exec(raw.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  if (!y || Number(y) < 1000) return undefined;
  return [y, mo, d].filter(Boolean).join('-');
}

/**
 * PDF `Title` fields are notoriously unreliable — authoring tools leave behind
 * the source filename, a browser URL, or nothing at all. Return '' for anything
 * that clearly is not a real title so the caller can fall back to the filename.
 */
export function cleanPdfTitle(raw?: string): string {
  let title = (raw ?? '').trim();
  // "Microsoft Word - report final.doc" and friends.
  title = title.replace(/^(Microsoft\s+\w+|Adobe\s+\w+|LaTeX)\s*-\s*/i, '').trim();
  title = title.replace(/\.(pdf|docx?|odt|indd|qxd|pages|rtf|tex|htm|html)$/i, '').trim();

  if (!title) return '';
  if (/^untitled\b/i.test(title)) return '';
  if (/^(about:|https?:|file:|data:)/i.test(title)) return '';
  if (/^(document|print|output|new document|slide\s*\d*)$/i.test(title)) return '';
  // A bare UUID or a long hex/number blob is a generated id, not a title.
  if (/^[0-9a-f]{8}-?[0-9a-f-]{8,}$/i.test(title)) return '';
  if (!/\p{L}/u.test(title)) return '';

  return title;
}

function splitAuthors(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\s*(?:;|,| and | & )\s*/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 1);
}

export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    // Without a DOM there is no canvas; we only ever pull the text layer.
    disableFontFace: true,
  }).promise;

  let info: Record<string, string> = {};
  try {
    const meta = await doc.getMetadata();
    info = (meta.info ?? {}) as Record<string, string>;
  } catch {
    // Encrypted or malformed metadata dictionaries are common; keep going.
  }

  const sections: ExtractedSection[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      page.cleanup();
      if (text.trim()) {
        sections.push({ index: pageNum - 1, title: `Page ${pageNum}`, href: String(pageNum), text });
      }
    } catch {
      // Skip pages we cannot decode rather than losing the whole document.
    }
  }

  const rawTitle = cleanPdfTitle(info.Title);
  const publishedDate = parsePdfDate(info.CreationDate);

  const metadata: ExtractedMetadata = {
    title: rawTitle || 'Untitled PDF',
    authors: splitAuthors(info.Author),
    // Deliberately no publisher: a PDF's `Producer`/`Creator` names the
    // software that wrote the file ("Skia/PDF", "Adobe PDF Library"), not a
    // publisher, and letting it through poisons the publisher facet.
    publisher: undefined,
    publishedDate,
    year: publishedDate ? Number(publishedDate.slice(0, 4)) || undefined : undefined,
    genres: (info.Keywords ?? '')
      .split(/[;,]/)
      .map((k) => k.trim())
      .filter(Boolean),
    description: info.Subject?.trim() || undefined,
    pageCount: doc.numPages,
  };

  await doc.destroy();
  return { metadata, sections };
}

/**
 * The text layer is a stream of positioned runs. `hasEOL` marks the end of a
 * visual line, which is the only line-break signal we get.
 */
function joinTextItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    out += item.str ?? '';
    if (item.hasEOL) out += '\n';
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
