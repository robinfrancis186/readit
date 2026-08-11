import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, fileUrl } from '../api';
import { SelectionPopup, type SelectionInfo } from '../components/SelectionPopup';
import { Toaster, toast } from '../components/Toast';
import { EpubReader, type TocEntry } from '../reader/EpubReader';
import { PdfReader } from '../reader/PdfReader';
import type { ItemDetail, SearchHit } from '../types';

export function ReaderPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const [params] = useSearchParams();

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [fontScale, setFontScale] = useState(() => Number(localStorage.getItem('readit-font') ?? 1));
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [panel, setPanel] = useState<'none' | 'toc' | 'search'>('none');
  const [gotoTarget, setGotoTarget] = useState<string | null>(null);
  const [chapter, setChapter] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  const progressRef = useRef({ locator: '', progress: 0 });

  useEffect(() => {
    api
      .item(itemId)
      .then((d) => {
        setDetail(d);
        setCounts(d.entryCounts);
      })
      .catch((err) => toast((err as Error).message, 'error'));
  }, [itemId]);

  useEffect(() => {
    localStorage.setItem('readit-font', String(fontScale));
  }, [fontScale]);

  // Persist the reading position when leaving, rather than on every page turn.
  useEffect(() => {
    const save = () => {
      const { locator, progress } = progressRef.current;
      if (!locator) return;
      void api
        .updateItem(itemId, { reading_locator: locator, reading_progress: progress })
        .catch(() => {});
    };
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [itemId]);

  const onLocationChange = useCallback((locator: string, progress: number, label: string) => {
    progressRef.current = { locator, progress };
    setChapter(label);
  }, []);

  if (!detail) {
    return <p className="p-8 text-soft">Opening…</p>;
  }

  const { item, documents } = detail;
  const excerptDoc = documents.find((d) => d.kind === 'excerpt');
  const vocabDoc = documents.find((d) => d.kind === 'vocab');
  const sectionParam = params.get('section');

  return (
    <div className="h-full flex flex-col bg-paper">
      <Toaster />
      <header className="shrink-0 border-b border-rule px-3 h-12 flex items-center gap-2 text-sm">
        <Link to={`/item/${item.id}`} className="btn py-1 px-2" title="Back to details">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{item.title}</p>
          {chapter && <p className="truncate text-xs text-soft">{chapter}</p>}
        </div>

        {item.file_format === 'epub' && (
          <button
            type="button"
            className="btn py-1 px-2"
            onClick={() => setPanel((p) => (p === 'toc' ? 'none' : 'toc'))}
            aria-pressed={panel === 'toc'}
          >
            Contents
          </button>
        )}
        <button
          type="button"
          className="btn py-1 px-2"
          onClick={() => setPanel((p) => (p === 'search' ? 'none' : 'search'))}
          aria-pressed={panel === 'search'}
        >
          Search
        </button>
        <div className="hidden sm:flex items-center gap-1">
          <button
            type="button"
            className="btn py-1 px-2"
            onClick={() => setFontScale((f) => Math.max(0.7, +(f - 0.1).toFixed(2)))}
            aria-label="Smaller text"
          >
            A−
          </button>
          <button
            type="button"
            className="btn py-1 px-2"
            onClick={() => setFontScale((f) => Math.min(2.2, +(f + 0.1).toFixed(2)))}
            aria-label="Larger text"
          >
            A+
          </button>
        </div>
        {excerptDoc && (
          <Link to={`/document/${excerptDoc.id}`} className="btn py-1 px-2" title="Reading notes">
            Notes <span className="text-soft">{counts.excerpt ?? 0}</span>
          </Link>
        )}
        {vocabDoc && (
          <Link to={`/document/${vocabDoc.id}`} className="btn py-1 px-2" title="Word list">
            Words <span className="text-soft">{counts.vocab ?? 0}</span>
          </Link>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        {panel !== 'none' && (
          <aside className="w-72 shrink-0 border-r border-rule overflow-y-auto p-3">
            {panel === 'toc' ? (
              <TocPanel toc={toc} onGo={(href) => setGotoTarget(href)} />
            ) : (
              <SearchPanel
                itemId={itemId}
                initial={params.get('q') ?? ''}
                isMalayalam={item.language === 'ml'}
                onGo={(hit) =>
                  setGotoTarget(item.file_format === 'pdf' ? String(hit.section_index + 1) : hit.section_href)
                }
              />
            )}
          </aside>
        )}

        <div className="flex-1 min-w-0">
          {item.file_format === 'epub' ? (
            <EpubReader
              url={fileUrl(item.id)}
              fontScale={fontScale}
              initialLocation={sectionParam ? undefined : item.reading_locator}
              onSelect={setSelection}
              onLocationChange={onLocationChange}
              onToc={setToc}
              gotoTarget={gotoTarget}
            />
          ) : (
            <PdfReader
              url={fileUrl(item.id)}
              fontScale={fontScale}
              initialPage={Number(sectionParam ?? item.reading_locator ?? 1) || 1}
              onSelect={setSelection}
              onLocationChange={onLocationChange}
              gotoTarget={gotoTarget}
            />
          )}
        </div>
      </div>

      {selection && (
        <SelectionPopup
          selection={selection}
          excerptDocId={excerptDoc?.id}
          vocabDocId={vocabDoc?.id}
          issueDate={item.issue_date}
          onClose={() => setSelection(null)}
          onSaved={(kind) => setCounts((c) => ({ ...c, [kind === 'word' ? 'vocab' : 'excerpt']: (c[kind === 'word' ? 'vocab' : 'excerpt'] ?? 0) + 1 }))}
        />
      )}
    </div>
  );
}

function TocPanel({ toc, onGo }: { toc: TocEntry[]; onGo: (href: string) => void }) {
  if (!toc.length) return <p className="text-sm text-soft">No table of contents.</p>;
  return (
    <nav>
      <h2 className="font-medium mb-2 text-sm">Contents</h2>
      <ul className="flex flex-col text-sm">
        {toc.map((entry, i) => (
          <li key={`${entry.href}-${i}`}>
            <button
              type="button"
              className="text-left w-full rounded px-2 py-1 hover:bg-accent-soft"
              style={{ paddingLeft: `${0.5 + entry.depth * 0.75}rem` }}
              onClick={() => onGo(entry.href)}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SearchPanel({
  itemId,
  initial,
  isMalayalam,
  onGo,
}: {
  itemId: number;
  initial: string;
  isMalayalam: boolean;
  onGo: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchInside(itemId, q)
        .then((r) => setHits(r.hits))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, itemId]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">Search inside</h2>
      <input
        className="field"
        placeholder="Keyword…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      {hits && hits.length === 0 && <p className="text-sm text-soft">No matches.</p>}
      <ul className="flex flex-col gap-2">
        {hits?.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              className="text-left w-full rounded p-2 hover:bg-accent-soft"
              onClick={() => onGo(hit)}
            >
              <span className="block text-[10px] uppercase tracking-wide text-soft">
                {hit.section_title ?? `Section ${hit.section_index + 1}`}
              </span>
              <span
                className={`block text-xs leading-relaxed ${isMalayalam ? 'ml' : ''}`}
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
