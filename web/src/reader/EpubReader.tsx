import ePub, { type Book, type Rendition } from 'epubjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionInfo } from '../components/SelectionPopup';

export interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

interface Props {
  url: string;
  fontScale: number;
  initialLocation?: string | null;
  onSelect: (info: SelectionInfo | null) => void;
  onLocationChange?: (locator: string, progress: number, label: string) => void;
  onToc?: (toc: TocEntry[]) => void;
  /** Bumped by the parent to jump somewhere; see ReaderPage. */
  gotoTarget?: string | null;
}

function flattenToc(items: Array<{ label: string; href: string; subitems?: unknown[] }>, depth = 0): TocEntry[] {
  const out: TocEntry[] = [];
  for (const item of items) {
    out.push({ label: (item.label ?? '').trim() || 'Untitled', href: item.href, depth });
    if (Array.isArray(item.subitems) && item.subitems.length) {
      out.push(...flattenToc(item.subitems as Array<{ label: string; href: string }>, depth + 1));
    }
  }
  return out;
}

export function EpubReader({
  url,
  fontScale,
  initialLocation,
  onSelect,
  onLocationChange,
  onToc,
  gotoTarget,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chapterRef = useRef<string>('');

  // Keep the newest callbacks without re-creating the rendition each render.
  const onSelectRef = useRef(onSelect);
  const onLocationChangeRef = useRef(onLocationChange);
  onSelectRef.current = onSelect;
  onLocationChangeRef.current = onLocationChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    // Hand epub.js the archive bytes rather than the URL. Given a URL it guesses
    // from the extension whether the target is a packaged .epub or an unzipped
    // directory, and our API path (/api/library/:id/file) makes it guess wrong.
    const book = ePub();
    bookRef.current = book;

    const opened = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) book.open(buffer, 'binary');
      });

    // epub.js lays out its columns from the size it is given. Percentages leave
    // it computing a width that overflows the host, so measure the box and keep
    // it in step with a ResizeObserver instead.
    const rendition = book.renderTo(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      spread: 'auto',
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    // The observer fires once as soon as it is attached, which is before
    // epub.js has a view manager to resize — hence the `displayed` guard.
    let displayed = false;
    const observer = new ResizeObserver(() => {
      if (!displayed || cancelled) return;
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        rendition.resize(host.clientWidth, host.clientHeight);
      }
    });
    observer.observe(host);

    // `selected` fires with the CFI range of whatever the reader highlighted
    // inside the sandboxed iframe.
    rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
      const sel = contents.window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text) {
        onSelectRef.current(null);
        return;
      }
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // Rects are relative to the iframe, so shift them into page coordinates.
      const frame = host.querySelector('iframe');
      const frameRect = frame?.getBoundingClientRect() ?? { top: 0, left: 0 };
      onSelectRef.current({
        text,
        rect: {
          top: rect.top + frameRect.top,
          bottom: rect.bottom + frameRect.top,
          left: rect.left + frameRect.left,
          width: rect.width,
        },
        locator: cfiRange,
        label: chapterRef.current,
      });
    });

    rendition.on('relocated', (location: { start: { cfi: string; href: string; percentage?: number } }) => {
      const href = location.start.href;
      const nav = book.navigation?.get(href);
      chapterRef.current = nav?.label?.trim() || '';
      onLocationChangeRef.current?.(
        location.start.cfi,
        location.start.percentage ?? 0,
        chapterRef.current,
      );
    });

    // Clicking outside a selection dismisses the popup.
    rendition.on('markClicked', () => onSelectRef.current(null));
    rendition.hooks.content.register((contents: { document: Document }) => {
      contents.document.addEventListener('mousedown', () => onSelectRef.current(null));
    });

    void opened
      .then(() => book.ready)
      .then(async () => {
        if (cancelled) return;
        const nav = await book.loaded.navigation;
        onToc?.(flattenToc((nav.toc ?? []) as Array<{ label: string; href: string; subitems?: unknown[] }>));
        await rendition.display(initialLocation ?? undefined);
        displayed = true;
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this EPUB.');
      });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void rendition.next();
      if (e.key === 'ArrowLeft') void rendition.prev();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener('keydown', onKey);
      rendition.destroy();
      book.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // The rendition is expensive to build; only the source URL should rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${Math.round(fontScale * 100)}%`);
  }, [fontScale, ready]);

  useEffect(() => {
    if (gotoTarget && renditionRef.current) void renditionRef.current.display(gotoTarget);
  }, [gotoTarget]);

  const next = useCallback(() => void renditionRef.current?.next(), []);
  const prev = useCallback(() => void renditionRef.current?.prev(), []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <p className="text-soft max-w-md">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={hostRef} className="h-full" />
      {!ready && (
        <p className="absolute inset-0 flex items-center justify-center text-soft pointer-events-none">
          Opening…
        </p>
      )}
      <PageButton side="left" onClick={prev} />
      <PageButton side="right" onClick={next} />
    </div>
  );
}

function PageButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous page' : 'Next page'}
      className={`absolute top-0 bottom-0 w-10 flex items-center justify-center text-2xl text-soft opacity-0 hover:opacity-100 transition-opacity ${
        side === 'left' ? 'left-0' : 'right-0'
      }`}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  );
}
