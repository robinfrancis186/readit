import { useEffect, useRef, useState } from 'react';
import type { SelectionInfo } from '../components/SelectionPopup';

interface Props {
  url: string;
  fontScale: number;
  initialPage?: number;
  onSelect: (info: SelectionInfo | null) => void;
  onLocationChange?: (locator: string, progress: number, label: string) => void;
  onPageCount?: (count: number) => void;
  gotoTarget?: string | null;
}

/**
 * Renders PDF pages to canvas with pdf.js and overlays its text layer, which is
 * what makes the text genuinely selectable (and therefore lookup-able) rather
 * than a flat image.
 */
export function PdfReader({
  url,
  fontScale,
  initialPage = 1,
  onSelect,
  onLocationChange,
  onPageCount,
  gotoTarget,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());

  const onSelectRef = useRef(onSelect);
  const onLocationChangeRef = useRef(onLocationChange);
  onSelectRef.current = onSelect;
  onLocationChangeRef.current = onLocationChange;

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      const pdfjs = await import('pdfjs-dist');
      // The worker ships with the package; Vite resolves it to a real URL.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();

      let doc;
      try {
        doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this PDF.');
        return;
      }
      if (cancelled) {
        void doc.destroy();
        return;
      }
      onPageCount?.(doc.numPages);

      const scale = Math.min(2.5, (window.devicePixelRatio || 1) * fontScale);
      container.replaceChildren();
      pageRefs.current.clear();

      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) break;
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const cssViewport = page.getViewport({ scale: fontScale });

        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page relative mx-auto mb-6 shadow-sm bg-white';
        wrapper.style.width = `${cssViewport.width}px`;
        wrapper.style.height = `${cssViewport.height}px`;
        wrapper.dataset.page = String(n);

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        wrapper.appendChild(canvas);

        const textLayerDiv = document.createElement('div');
        // pdf.js positions spans against these CSS variables.
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.setProperty('--scale-factor', String(fontScale));
        wrapper.appendChild(textLayerDiv);

        container.appendChild(wrapper);
        pageRefs.current.set(n, wrapper);

        const ctx = canvas.getContext('2d');
        if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;

        const textContent = await page.getTextContent();
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: cssViewport,
        });
        await textLayer.render();
      }

      if (!cancelled) {
        setLoading(false);
        const target = pageRefs.current.get(initialPage);
        if (target && initialPage > 1) target.scrollIntoView();
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-rendering every page is costly, so only the file or zoom triggers it.
  }, [url, fontScale, initialPage, onPageCount]);

  // Report the page currently in view so progress can be saved.
  useEffect(() => {
    const scroller = containerRef.current?.parentElement;
    if (!scroller) return;
    const onScroll = () => {
      const mid = scroller.scrollTop + scroller.clientHeight / 2;
      for (const [n, el] of pageRefs.current) {
        if (el.offsetTop <= mid && el.offsetTop + el.offsetHeight >= mid) {
          const total = pageRefs.current.size || 1;
          onLocationChangeRef.current?.(String(n), n / total, `p. ${n}`);
          break;
        }
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [loading]);

  useEffect(() => {
    if (!gotoTarget) return;
    const target = pageRefs.current.get(Number(gotoTarget));
    target?.scrollIntoView({ behavior: 'smooth' });
  }, [gotoTarget]);

  // Selection lives in the normal DOM here, so a document-level listener works.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!text || !sel || sel.rangeCount === 0) {
        onSelectRef.current(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;

      const rect = range.getBoundingClientRect();
      const pageEl = (range.startContainer.parentElement as HTMLElement | null)?.closest('.pdf-page');
      const pageNumber = pageEl?.getAttribute('data-page') ?? undefined;
      onSelectRef.current({
        text,
        rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
        locator: pageNumber,
        label: pageNumber ? `p. ${pageNumber}` : undefined,
      });
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onMouseUp);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onMouseUp);
    };
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <p className="text-soft max-w-md">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto py-6">
      <div ref={containerRef} />
      {loading && <p className="text-center text-soft">Rendering pages…</p>}
    </div>
  );
}
