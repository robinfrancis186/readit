import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, coverUrl, type LibraryQuery } from '../api';
import { Toaster, toast } from '../components/Toast';
import { UploadDialog } from '../components/UploadDialog';
import { KIND_LABELS, languageName, type Facets, type Item, type ItemKind } from '../types';

const SORTS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'opened', label: 'Recently opened' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'author', label: 'Author A–Z' },
  { value: 'year', label: 'Newest published' },
];

const EMPTY: LibraryQuery = { sort: 'recent' };

export function LibraryPage() {
  const [query, setQuery] = useState<LibraryQuery>(EMPTY);
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Debounce the free-text box so typing doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => ({ ...q, q: text || undefined })), 220);
    return () => clearTimeout(t);
  }, [text]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, f] = await Promise.all([api.listItems(query), api.facets()]);
      setItems(list.items);
      setTotal(list.total);
      setFacets(f);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFacet = (key: keyof LibraryQuery, value: string | undefined) =>
    setQuery((q) => ({ ...q, [key]: q[key] === value ? undefined : value }));

  const activeFilters = useMemo(
    () =>
      (['kind', 'language', 'author', 'genre', 'publisher', 'series'] as const)
        .filter((k) => query[k])
        .map((k) => ({ key: k, value: String(query[k]) })),
    [query],
  );

  return (
    <div className="flex flex-col gap-5">
      <Toaster />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <input
            className="field pl-9"
            placeholder="Search title, author, publisher, genre…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Search the library"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-soft" aria-hidden>
            ⌕
          </span>
        </div>
        <select
          className="field w-auto"
          value={query.sort ?? 'recent'}
          onChange={(e) => setQuery((q) => ({ ...q, sort: e.target.value }))}
          aria-label="Sort order"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {/* On a phone the facet list would push every book below the fold, so
            it collapses behind this toggle and the results come first. */}
        <button
          type="button"
          className="btn lg:hidden"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="library-facets"
        >
          Filters
          {activeFilters.length > 0 && (
            <span className="text-xs rounded-full bg-accent-soft text-accent px-1.5">
              {activeFilters.length}
            </span>
          )}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          <span className="sm:hidden">+ Add</span>
          <span className="hidden sm:inline">+ Add to library</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
        <FacetSidebar
          facets={facets}
          query={query}
          setFacet={setFacet}
          setQuery={setQuery}
          open={showFilters}
        />

        <section className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-soft">
            <span>
              {loading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'}`}
            </span>
            {activeFilters.map((f) => (
              <button
                key={`${f.key}:${f.value}`}
                type="button"
                className="btn py-0.5 px-2 text-xs"
                onClick={() => setFacet(f.key, undefined)}
              >
                {f.value} ✕
              </button>
            ))}
            {(activeFilters.length > 0 || query.yearFrom || query.yearTo) && (
              <button
                type="button"
                className="text-accent underline underline-offset-2 text-xs"
                onClick={() => {
                  setQuery({ sort: query.sort });
                  setText('');
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {!loading && items.length === 0 ? (
            <EmptyState onAdd={() => setUploadOpen(true)} filtered={Boolean(text || activeFilters.length)} />
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function FacetSidebar({
  facets,
  query,
  setFacet,
  setQuery,
  open,
}: {
  facets: Facets | null;
  query: LibraryQuery;
  setFacet: (key: keyof LibraryQuery, value: string | undefined) => void;
  setQuery: React.Dispatch<React.SetStateAction<LibraryQuery>>;
  open: boolean;
}) {
  if (!facets) return <aside aria-hidden />;

  return (
    <aside
      id="library-facets"
      className={`${open ? 'flex' : 'hidden'} lg:flex flex-col gap-5 text-sm lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto pr-1`}
    >
      <FacetGroup
        title="Type"
        values={facets.kinds.map((k) => ({ ...k, label: KIND_LABELS[k.value as ItemKind] ?? k.value }))}
        selected={query.kind}
        onSelect={(v) => setFacet('kind', v)}
      />
      <FacetGroup
        title="Language"
        values={facets.languages.map((l) => ({ ...l, label: languageName(l.value) }))}
        selected={query.language}
        onSelect={(v) => setFacet('language', v)}
      />
      <FacetGroup title="Author" values={facets.authors} selected={query.author} onSelect={(v) => setFacet('author', v)} />
      <FacetGroup title="Genre" values={facets.genres} selected={query.genre} onSelect={(v) => setFacet('genre', v)} />
      <FacetGroup
        title="Publisher"
        values={facets.publishers}
        selected={query.publisher}
        onSelect={(v) => setFacet('publisher', v)}
      />
      {facets.series.length > 0 && (
        <FacetGroup title="Series" values={facets.series} selected={query.series} onSelect={(v) => setFacet('series', v)} />
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Year published</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="field"
            placeholder={facets.years.min ? String(facets.years.min) : 'From'}
            value={query.yearFrom ?? ''}
            onChange={(e) =>
              setQuery((q) => ({ ...q, yearFrom: e.target.value ? Number(e.target.value) : undefined }))
            }
            aria-label="Published from year"
          />
          <span className="text-soft">–</span>
          <input
            type="number"
            className="field"
            placeholder={facets.years.max ? String(facets.years.max) : 'To'}
            value={query.yearTo ?? ''}
            onChange={(e) =>
              setQuery((q) => ({ ...q, yearTo: e.target.value ? Number(e.target.value) : undefined }))
            }
            aria-label="Published to year"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Issue / publication date</h3>
        <input
          type="date"
          className="field"
          value={query.dateFrom ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, dateFrom: e.target.value || undefined }))}
          aria-label="Issue date from"
        />
        <input
          type="date"
          className="field"
          value={query.dateTo ?? ''}
          onChange={(e) => setQuery((q) => ({ ...q, dateTo: e.target.value || undefined }))}
          aria-label="Issue date to"
        />
      </div>
    </aside>
  );
}

function FacetGroup({
  title,
  values,
  selected,
  onSelect,
}: {
  title: string;
  values: Array<{ value: string; count: number; label?: string }>;
  selected: string | undefined;
  onSelect: (value: string | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!values.length) return null;
  const shown = expanded ? values : values.slice(0, 6);

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="font-medium">{title}</h3>
      <ul className="flex flex-col">
        {shown.map((v) => (
          <li key={v.value}>
            <button
              type="button"
              onClick={() => onSelect(v.value)}
              aria-pressed={selected === v.value}
              className={`w-full text-left flex justify-between gap-2 rounded px-2 py-1 transition-colors ${
                selected === v.value ? 'bg-accent-soft text-accent font-medium' : 'bg-accent-hover'
              }`}
            >
              <span className="truncate">{v.label ?? v.value}</span>
              <span className="text-soft tabular-nums text-xs shrink-0">{v.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {values.length > 6 && (
        <button
          type="button"
          className="text-xs text-accent self-start px-2"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : `Show all ${values.length}`}
        </button>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: Item }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = item.cover_path && !coverFailed;
  const date = item.issue_date ?? (item.year ? String(item.year) : null);

  return (
    <li>
      <Link to={`/item/${item.id}`} className="group flex flex-col gap-2 h-full">
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden border border-rule bg-raised">
          {showCover ? (
            <img
              src={coverUrl(item.id)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="w-full h-full flex flex-col justify-center p-3 text-center gap-1 bg-accent-soft">
              <span className="font-serif text-sm leading-snug line-clamp-5">{item.title}</span>
            </div>
          )}
          <span className="absolute top-1.5 left-1.5 text-[10px] uppercase tracking-wide bg-raised-blur rounded px-1.5 py-0.5 border border-rule">
            {item.file_format}
          </span>
          {item.reading_progress > 0.01 && (
            <span className="absolute bottom-0 inset-x-0 h-1 bg-black/20">
              <span
                className="block h-full bg-[var(--accent)]"
                style={{ width: `${Math.min(100, item.reading_progress * 100)}%` }}
              />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-medium leading-snug line-clamp-2 group-hover:text-accent transition-colors">
            {item.title}
          </p>
          <p className="text-sm text-soft truncate">
            {item.authors.join(', ') || KIND_LABELS[item.kind]}
          </p>
          {date && <p className="text-xs text-soft">{date}</p>}
        </div>
      </Link>
    </li>
  );
}

function EmptyState({ onAdd, filtered }: { onAdd: () => void; filtered: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="card p-10 flex flex-col items-center text-center gap-3">
      <span className="text-4xl" aria-hidden>
        {filtered ? '🔍' : '📖'}
      </span>
      <h2 className="text-lg font-medium">{filtered ? 'Nothing matches those filters' : 'Your library is empty'}</h2>
      <p className="text-soft max-w-md">
        {filtered
          ? 'Try clearing a filter or searching for something else.'
          : 'Add an EPUB or PDF — a book, a magazine issue, a newspaper, or any document. Readit reads its metadata and indexes the text for searching.'}
      </p>
      {!filtered && (
        <button type="button" className="btn btn-primary mt-1" onClick={onAdd}>
          Add your first item
        </button>
      )}
    </div>
  );
}
