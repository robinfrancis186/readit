import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { posix } from 'node:path';
import type { ExtractedMetadata, ExtractedSection } from './types.js';
import { htmlToText } from './text.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // A single <dc:creator> and a list of them must both come back as arrays so
  // downstream code has one shape to deal with.
  isArray: (name) => ['item', 'itemref', 'dc:creator', 'dc:subject', 'dc:identifier'].includes(name),
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** OPF text nodes are either a bare string or `{ '#text': ..., '@_attr': ... }`. */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    const t = (node as Record<string, unknown>)['#text'];
    return t === undefined || t === null ? undefined : String(t).trim() || undefined;
  }
  return undefined;
}

export interface EpubParseResult {
  metadata: ExtractedMetadata;
  sections: ExtractedSection[];
  cover?: { data: Buffer; ext: string };
}

export function parseEpub(buffer: Buffer): EpubParseResult {
  const zip = new AdmZip(buffer);
  const read = (path: string): Buffer | null => zip.getEntry(path)?.getData() ?? null;

  // 1. container.xml points at the OPF package document.
  const containerXml = read('META-INF/container.xml');
  if (!containerXml) throw new Error('Not a valid EPUB: META-INF/container.xml missing');
  const container = parser.parse(containerXml.toString('utf8'));
  const rootfiles = asArray(container?.container?.rootfiles?.rootfile);
  const opfPath: string | undefined = rootfiles[0]?.['@_full-path'];
  if (!opfPath) throw new Error('Not a valid EPUB: no rootfile in container.xml');

  const opfBuf = read(opfPath);
  if (!opfBuf) throw new Error(`Not a valid EPUB: ${opfPath} missing`);
  const opf = parser.parse(opfBuf.toString('utf8'));
  const pkg = opf.package ?? {};
  const meta = pkg.metadata ?? {};
  const opfDir = posix.dirname(opfPath);
  const resolveHref = (href: string) => (opfDir === '.' ? href : posix.join(opfDir, href));

  // 2. Dublin Core metadata → our library fields.
  const creators = asArray(meta['dc:creator'])
    .map((c) => textOf(c))
    .filter((c): c is string => Boolean(c));
  const subjects = asArray(meta['dc:subject'])
    .map((s) => textOf(s))
    .filter((s): s is string => Boolean(s) && s!.toLowerCase() !== 'null');

  const rawDate = textOf(meta['dc:date']);
  const description = textOf(meta['dc:description']);
  const identifiers = asArray(meta['dc:identifier']).map((i) => textOf(i)).filter(Boolean) as string[];
  const isbn = identifiers.find((i) => /^(urn:isbn:)?[\d-]{10,17}$/i.test(i))?.replace(/^urn:isbn:/i, '');

  // calibre and friends stash extras in <meta name="..." content="...">.
  const metaTags = asArray(meta.meta) as Array<Record<string, string>>;
  const metaByName = new Map<string, string>();
  for (const m of metaTags) {
    const name = m['@_name'];
    const content = m['@_content'];
    if (name && content) metaByName.set(name, content);
  }

  const metadata: ExtractedMetadata = {
    title: textOf(meta['dc:title']) ?? 'Untitled',
    authors: creators,
    language: normaliseLang(textOf(meta['dc:language'])),
    publisher: textOf(meta['dc:publisher']),
    publishedDate: rawDate,
    year: rawDate ? Number(rawDate.slice(0, 4)) || undefined : undefined,
    genres: subjects,
    description: description && description.toLowerCase() !== 'null' ? description : undefined,
    isbn,
    series: metaByName.get('calibre:series'),
  };

  // 3. Walk the spine so sections come out in reading order.
  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of asArray(pkg.manifest?.item) as Array<Record<string, string>>) {
    const id = item['@_id'];
    const href = item['@_href'];
    if (id && href) manifest.set(id, { href, type: item['@_media-type'] ?? '' });
  }

  const titlesByHref = readNavTitles(zip, pkg, manifest, resolveHref, parser);

  const sections: ExtractedSection[] = [];
  const spine = asArray(pkg.spine?.itemref) as Array<Record<string, string>>;
  for (const ref of spine) {
    const entry = manifest.get(ref['@_idref']);
    if (!entry || !/html|xml/.test(entry.type)) continue;
    const buf = read(resolveHref(entry.href));
    if (!buf) continue;
    const text = htmlToText(buf.toString('utf8'));
    if (!text.trim()) continue;
    sections.push({
      index: sections.length,
      href: entry.href,
      title: titlesByHref.get(entry.href) ?? deriveTitle(text),
      text,
    });
  }

  return { metadata, sections, cover: findCover(zip, pkg, manifest, metaByName, resolveHref) };
}

/** EPUB 2 (`dc:language`) is often `en-GB`; we key facets off the base tag. */
function normaliseLang(lang?: string): string | undefined {
  if (!lang) return undefined;
  const base = lang.trim().toLowerCase().split(/[-_]/)[0];
  return base || undefined;
}

/** First non-trivial line of a section is a decent chapter title fallback. */
function deriveTitle(text: string): string | undefined {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 2 && l.length < 120);
  return line;
}

/** Prefer real chapter names from the EPUB 3 nav doc or EPUB 2 NCX. */
function readNavTitles(
  zip: AdmZip,
  pkg: Record<string, any>,
  manifest: Map<string, { href: string; type: string }>,
  resolveHref: (h: string) => string,
  xml: XMLParser,
): Map<string, string> {
  const titles = new Map<string, string>();
  const strip = (href: string) => href.split('#')[0];

  const tocId: string | undefined = pkg.spine?.['@_toc'];
  const ncxEntry = tocId ? manifest.get(tocId) : undefined;
  if (ncxEntry) {
    const buf = zip.getEntry(resolveHref(ncxEntry.href))?.getData();
    if (buf) {
      try {
        const ncx = xml.parse(buf.toString('utf8'));
        const walk = (points: any): void => {
          for (const p of Array.isArray(points) ? points : [points]) {
            if (!p) continue;
            const label = textOf(p.navLabel?.text);
            const src = p.content?.['@_src'];
            if (label && src) titles.set(strip(src), label);
            if (p.navPoint) walk(p.navPoint);
          }
        };
        if (ncx?.ncx?.navMap?.navPoint) walk(ncx.ncx.navMap.navPoint);
      } catch {
        // A malformed TOC is not worth failing an import over.
      }
    }
  }
  return titles;
}

function findCover(
  zip: AdmZip,
  pkg: Record<string, any>,
  manifest: Map<string, { href: string; type: string }>,
  metaByName: Map<string, string>,
  resolveHref: (h: string) => string,
): { data: Buffer; ext: string } | undefined {
  const candidates: string[] = [];

  const coverId = metaByName.get('cover');
  if (coverId && manifest.has(coverId)) candidates.push(manifest.get(coverId)!.href);

  for (const item of manifest.values()) {
    if (item.type.startsWith('image/') && /cover/i.test(item.href)) candidates.push(item.href);
  }
  // Last resort: the first image in the manifest.
  for (const item of manifest.values()) {
    if (item.type.startsWith('image/')) candidates.push(item.href);
  }

  for (const href of candidates) {
    const data = zip.getEntry(resolveHref(href))?.getData();
    if (data?.length) {
      const ext = posix.extname(href).replace('.', '').toLowerCase() || 'jpg';
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return { data, ext };
    }
  }
  return undefined;
}
