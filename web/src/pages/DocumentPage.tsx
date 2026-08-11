import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, exportUrl } from '../api';
import { Toaster, toast } from '../components/Toast';
import type { DocPage, DocumentPayload, Entry } from '../types';

export function DocumentPage() {
  const { id } = useParams();
  const docId = Number(id);

  const [data, setData] = useState<DocumentPayload | null>(null);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState<{ q?: string; from?: string; to?: string }>({});

  useEffect(() => {
    const t = setTimeout(
      () => setQuery({ q: q || undefined, from: from || undefined, to: to || undefined }),
      220,
    );
    return () => clearTimeout(t);
  }, [q, from, to]);

  const load = useCallback(async () => {
    try {
      setData(await api.document(docId, query));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [docId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const byPage = useMemo(() => {
    if (!data) return [];
    return data.pages
      .map((page) => ({ page, entries: data.entries.filter((e) => e.page_id === page.id) }))
      .filter((group) => group.entries.length > 0 || !data.filtered);
  }, [data]);

  if (!data) return <p className="text-soft">Loading…</p>;

  const { document: doc, item } = data;
  const isVocab = doc.kind === 'vocab';
  const isPeriodical = item?.kind === 'magazine' || item?.kind === 'newspaper';
  const total = data.entries.length;

  const addPage = async () => {
    try {
      const title = prompt(isPeriodical ? 'Issue date (YYYY-MM-DD) for the new page:' : 'Title for the new page:');
      if (title === null) return;
      if (isPeriodical && /^\d{4}-\d{2}-\d{2}$/.test(title)) {
        await api.addPage(docId, { issueDate: title, title: `Issue of ${title}` });
      } else {
        await api.addPage(docId, { title: title || undefined });
      }
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Toaster />

      <div className="flex flex-col gap-1">
        {item && (
          <Link to={`/item/${item.id}`} className="text-sm text-soft hover:text-accent w-fit">
            ← {item.title}
          </Link>
        )}
        <h1 className="text-xl font-serif leading-snug">{doc.title}</h1>
        <p className="text-sm text-soft">
          {isVocab
            ? 'Words and phrases you looked up, grouped by the day you read them.'
            : isPeriodical
              ? 'Excerpts, kept on a separate page for each issue date.'
              : 'Excerpts you saved while reading, in the order you took them.'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 card p-3">
        <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
          <span className="text-xs text-soft">Search {isVocab ? 'words and meanings' : 'excerpts'}</span>
          <input className="field" placeholder="Keyword…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-soft">From</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-soft">To</span>
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(q || from || to) && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQ('');
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={addPage}>
            + Page
          </button>
          <a className="btn" href={exportUrl(docId)} download>
            Export
          </a>
        </div>
      </div>

      {data.filtered && (
        <p className="text-sm text-soft">
          {total} matching {total === 1 ? 'entry' : 'entries'}
        </p>
      )}

      {byPage.length === 0 ? (
        <div className="card p-10 text-center flex flex-col gap-2 items-center">
          <span className="text-3xl" aria-hidden>
            {data.filtered ? '🔍' : isVocab ? '🔤' : '✍️'}
          </span>
          <p className="font-medium">{data.filtered ? 'Nothing matches' : 'Nothing here yet'}</p>
          <p className="text-soft max-w-md text-sm">
            {data.filtered
              ? 'Try a different keyword or widen the date range.'
              : isVocab
                ? 'While reading, select a word and choose “Save word” in the popup. It lands here with its meanings, filed under the date you read it.'
                : 'While reading, select some text and choose “Add to notes”.'}
          </p>
          {item && (
            <Link to={`/read/${item.id}`} className="btn btn-primary mt-1">
              Open the reader
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {byPage.map(({ page, entries }) => (
            <PageBlock
              key={page.id}
              page={page}
              entries={entries}
              isVocab={isVocab}
              itemId={item?.id}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PageBlock({
  page,
  entries,
  isVocab,
  itemId,
  onChanged,
}: {
  page: DocPage;
  entries: Entry[];
  isVocab: boolean;
  itemId?: number;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(page.title ?? `Page ${page.page_number}`);

  const saveTitle = async () => {
    if (title === (page.title ?? '')) return;
    try {
      await api.updatePage(page.id, { title });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 border-b border-rule pb-2">
        <span className="text-xs text-soft tabular-nums shrink-0 w-6" aria-hidden>
          {page.page_number}
        </span>
        <input
          className="font-serif text-lg bg-transparent border-0 outline-none flex-1 min-w-0 focus:underline decoration-[var(--accent)] underline-offset-4"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          aria-label={`Title of page ${page.page_number}`}
        />
        {page.issue_date && (
          <time className="text-sm text-soft shrink-0" dateTime={page.issue_date}>
            {page.issue_date}
          </time>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-soft italic">Empty page.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={entry.id}>
              {isVocab || entry.kind === 'word' ? (
                <WordEntry entry={entry} itemId={itemId} onChanged={onChanged} />
              ) : (
                <ExcerptEntry entry={entry} itemId={itemId} onChanged={onChanged} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Excerpt bodies are directly editable; edits save when focus leaves. */
function ExcerptEntry({ entry, itemId, onChanged }: { entry: Entry; itemId?: number; onChanged: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState(entry.note ?? '');
  const [showNote, setShowNote] = useState(Boolean(entry.note));

  const saveBody = async () => {
    const el = bodyRef.current;
    if (!el) return;
    const text = el.innerText.trim();
    if (text === entry.content_text.trim()) return;
    try {
      await api.updateEntry(entry.id, { text, html: el.innerHTML });
      toast('Saved.');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const saveNote = async () => {
    if (note === (entry.note ?? '')) return;
    try {
      await api.updateEntry(entry.id, { note: note || null });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <article className="card p-4 flex flex-col gap-2">
      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={saveBody}
        className={`prose-reader whitespace-pre-wrap ${entry.lang === 'ml' ? 'ml' : ''}`}
        dangerouslySetInnerHTML={{ __html: entry.content_html }}
      />
      {showNote && (
        <textarea
          className="field text-sm"
          rows={2}
          placeholder="Your note…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
        />
      )}
      <EntryFooter
        entry={entry}
        itemId={itemId}
        onChanged={onChanged}
        extra={
          !showNote && (
            <button type="button" className="hover:text-accent" onClick={() => setShowNote(true)}>
              Add note
            </button>
          )
        }
      />
    </article>
  );
}

function WordEntry({ entry, itemId, onChanged }: { entry: Entry; itemId?: number; onChanged: () => void }) {
  const [note, setNote] = useState(entry.note ?? '');
  const isMl = entry.lang === 'ml';

  const saveNote = async () => {
    if (note === (entry.note ?? '')) return;
    try {
      await api.updateEntry(entry.id, { note: note || null });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <article className="card p-4 flex flex-col gap-2">
      <h3 className={`font-serif text-lg ${isMl ? 'ml' : ''}`} lang={entry.lang ?? undefined}>
        {entry.word ?? entry.content_text}
      </h3>
      {entry.meanings && entry.meanings.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {entry.meanings.map((result, i) => (
            <li key={`${result.source}-${i}`} className="text-sm">
              <div className="flex items-baseline gap-2">
                <span className={`font-medium ${isMl ? 'ml' : ''}`}>{result.headword}</span>
                <span className="text-[10px] uppercase tracking-wide text-soft">{result.source}</span>
              </div>
              <ol className="pl-5 list-decimal marker:text-soft">
                {result.senses.map((sense, j) => (
                  <li key={j} className="leading-snug">
                    {sense.pos && <em className="text-soft mr-1">{sense.pos}</em>}
                    {sense.definition}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-soft italic">No dictionary entry was found when this word was saved.</p>
      )}
      <textarea
        className="field text-sm"
        rows={2}
        placeholder="Your note — how it was used, a translation you prefer…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
      />
      <EntryFooter entry={entry} itemId={itemId} onChanged={onChanged} />
    </article>
  );
}

function EntryFooter({
  entry,
  itemId,
  onChanged,
  extra,
}: {
  entry: Entry;
  itemId?: number;
  onChanged: () => void;
  extra?: React.ReactNode;
}) {
  const remove = async () => {
    if (!confirm('Delete this entry?')) return;
    try {
      await api.deleteEntry(entry.id);
      toast('Deleted.');
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <footer className="flex flex-wrap items-center gap-3 text-xs text-soft pt-1">
      {itemId && entry.source_locator ? (
        <Link
          to={`/read/${itemId}?section=${encodeURIComponent(entry.source_locator)}`}
          className="hover:text-accent underline underline-offset-2"
          title="Open this passage in the reader"
        >
          {entry.source_label ?? 'Go to source'}
        </Link>
      ) : (
        entry.source_label && <span>{entry.source_label}</span>
      )}
      <time dateTime={entry.reading_date}>Read {entry.reading_date}</time>
      {entry.issue_date && <span>Issue {entry.issue_date}</span>}
      <span className="ml-auto flex items-center gap-3">
        {extra}
        <button type="button" className="hover:text-red-600" onClick={remove}>
          Delete
        </button>
      </span>
    </footer>
  );
}
