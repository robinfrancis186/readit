import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, coverUrl } from '../api';
import { Toaster, toast } from '../components/Toast';
import { KIND_LABELS, languageName, type ItemDetail, type ItemKind, type SearchHit } from '../types';

export function ItemPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();
  const [data, setData] = useState<ItemDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [insideQuery, setInsideQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.item(itemId));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!insideQuery.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { hits } = await api.searchInside(itemId, insideQuery);
        setHits(hits);
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [insideQuery, itemId]);

  if (!data) return <p className="text-soft">Loading…</p>;
  const { item, documents, entryCounts } = data;
  const excerptDoc = documents.find((d) => d.kind === 'excerpt');
  const vocabDoc = documents.find((d) => d.kind === 'vocab');

  const remove = async () => {
    if (!confirm(`Remove “${item.title}” from the library? Its reading notes and word list are deleted too.`)) {
      return;
    }
    try {
      await api.deleteItem(itemId);
      toast('Removed from library.');
      navigate('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Toaster />
      <Link to="/" className="text-sm text-soft hover:text-accent w-fit">
        ← Library
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-6">
        <div className="w-40 md:w-full">
          <div className="aspect-[2/3] rounded-lg overflow-hidden border border-rule bg-accent-soft">
            {item.cover_path ? (
              <img src={coverUrl(item.id)} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-3 text-center font-serif text-sm">
                {item.title}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div>
            <p className="text-xs uppercase tracking-wide text-soft">{KIND_LABELS[item.kind]}</p>
            <h1 className="text-2xl font-serif leading-tight">{item.title}</h1>
            {item.subtitle && <p className="text-lg text-soft font-serif">{item.subtitle}</p>}
            {item.authors.length > 0 && <p className="mt-1">{item.authors.join(', ')}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to={`/read/${item.id}`} className="btn btn-primary">
              Read
            </Link>
            {excerptDoc && (
              <Link to={`/document/${excerptDoc.id}`} className="btn">
                Reading notes
                <span className="text-soft text-xs">{entryCounts.excerpt ?? 0}</span>
              </Link>
            )}
            {vocabDoc && (
              <Link to={`/document/${vocabDoc.id}`} className="btn">
                Word list
                <span className="text-soft text-xs">{entryCounts.vocab ?? 0}</span>
              </Link>
            )}
            <button type="button" className="btn" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done editing' : 'Edit details'}
            </button>
            <button type="button" className="btn ml-auto text-red-600" onClick={remove}>
              Remove
            </button>
          </div>

          {editing ? (
            <MetadataForm
              detail={data}
              onSaved={() => {
                setEditing(false);
                void load();
              }}
            />
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm card p-4">
              <Field label="Language" value={item.language ? languageName(item.language) : null} />
              <Field label="Publisher" value={item.publisher} />
              <Field label="Published" value={item.published_date?.slice(0, 10) ?? (item.year ? String(item.year) : null)} />
              <Field label="Edition" value={item.edition} />
              <Field label="Series" value={item.series} />
              <Field label="Issue date" value={item.issue_date} />
              <Field label="Issue number" value={item.issue_number} />
              <Field label="Volume" value={item.volume} />
              <Field label="Genres" value={item.genres.join(', ') || null} />
              <Field label="ISBN" value={item.isbn} />
              <Field label="Format" value={`${item.file_format.toUpperCase()}${item.page_count ? ` · ${item.page_count} pages` : ''}`} />
              <Field label="Added" value={item.added_at.slice(0, 10)} />
            </dl>
          )}

          {item.description && (
            <p className="text-sm text-soft leading-relaxed max-w-2xl">{item.description}</p>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Search inside this {KIND_LABELS[item.kind].toLowerCase()}</h2>
        <input
          className="field max-w-xl"
          placeholder="Keyword…"
          value={insideQuery}
          onChange={(e) => setInsideQuery(e.target.value)}
        />
        {hits && (
          <ul className="flex flex-col gap-2 max-w-3xl">
            {hits.length === 0 && <li className="text-soft text-sm">No matches.</li>}
            {hits.map((hit) => (
              <li key={hit.id} className="card p-3">
                <Link
                  to={`/read/${item.id}?section=${hit.section_index}&q=${encodeURIComponent(insideQuery)}`}
                  className="flex flex-col gap-1"
                >
                  <span className="text-xs uppercase tracking-wide text-soft">
                    {hit.section_title ?? `Section ${hit.section_index + 1}`}
                  </span>
                  <span
                    className={`text-sm leading-relaxed ${item.language === 'ml' ? 'ml' : ''}`}
                    // Snippets come from SQLite's snippet(), which only ever
                    // inserts the <mark> tags we asked for.
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-soft">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function MetadataForm({ detail, onSaved }: { detail: ItemDetail; onSaved: () => void }) {
  const { item } = detail;
  const [form, setForm] = useState({
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle ?? '',
    authors: item.authors.join(', '),
    language: item.language ?? '',
    publisher: item.publisher ?? '',
    published_date: item.published_date?.slice(0, 10) ?? '',
    edition: item.edition ?? '',
    genres: item.genres.join(', '),
    isbn: item.isbn ?? '',
    series: item.series ?? '',
    issue_date: item.issue_date?.slice(0, 10) ?? '',
    issue_number: item.issue_number ?? '',
    volume: item.volume ?? '',
    description: item.description ?? '',
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await api.updateItem(item.id, {
        kind: form.kind,
        title: form.title.trim() || item.title,
        subtitle: form.subtitle.trim() || null,
        authors: form.authors.split(',').map((s) => s.trim()).filter(Boolean),
        language: form.language.trim() || null,
        publisher: form.publisher.trim() || null,
        published_date: form.published_date || null,
        edition: form.edition.trim() || null,
        genres: form.genres.split(',').map((s) => s.trim()).filter(Boolean),
        isbn: form.isbn.trim() || null,
        series: form.series.trim() || null,
        issue_date: form.issue_date || null,
        issue_number: form.issue_number.trim() || null,
        volume: form.volume.trim() || null,
        description: form.description.trim() || null,
      });
      toast('Details updated. Notebook titles now match.');
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <Input label="Title" value={form.title} onChange={set('title')} />
      <Input label="Subtitle" value={form.subtitle} onChange={set('subtitle')} />
      <Input label="Authors (comma separated)" value={form.authors} onChange={set('authors')} />
      <label className="flex flex-col gap-1">
        <span className="text-soft text-xs">Type</span>
        <select className="field" value={form.kind} onChange={set('kind')}>
          {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <Input label="Language code (en, ml…)" value={form.language} onChange={set('language')} />
      <Input label="Publisher" value={form.publisher} onChange={set('publisher')} />
      <Input label="Published date" type="date" value={form.published_date} onChange={set('published_date')} />
      <Input label="Edition" value={form.edition} onChange={set('edition')} />
      <Input label="Genres (comma separated)" value={form.genres} onChange={set('genres')} />
      <Input label="Series" value={form.series} onChange={set('series')} />
      <Input label="Issue date" type="date" value={form.issue_date} onChange={set('issue_date')} />
      <Input label="Issue number" value={form.issue_number} onChange={set('issue_number')} />
      <Input label="Volume" value={form.volume} onChange={set('volume')} />
      <Input label="ISBN" value={form.isbn} onChange={set('isbn')} />
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-soft text-xs">Description</span>
        <textarea className="field" rows={3} value={form.description} onChange={set('description')} />
      </label>
      <div className="sm:col-span-2 flex justify-end">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-soft text-xs">{label}</span>
      <input className="field" type={type} value={value} onChange={onChange} />
    </label>
  );
}
