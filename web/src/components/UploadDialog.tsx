import { useRef, useState } from 'react';
import { api } from '../api';
import { toast } from './Toast';
import { KIND_LABELS, type ItemKind } from '../types';

/**
 * Upload accepts several files at once. The classification fields are optional —
 * whatever the EPUB/PDF already declares wins unless you override it here, which
 * is mainly useful for periodicals, where the issue date is what matters.
 */
export function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<ItemKind | ''>('');
  const [issueDate, setIssueDate] = useState('');
  const [issueNumber, setIssueNumber] = useState('');
  const [language, setLanguage] = useState('');
  const [genres, setGenres] = useState('');
  const [edition, setEdition] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPeriodical = kind === 'magazine' || kind === 'newspaper';

  const accept = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].filter((f) => /\.(epub|pdf)$/i.test(f.name));
    const rejected = list.length - picked.length;
    if (rejected > 0) toast(`${rejected} file(s) skipped — only EPUB and PDF are supported.`, 'error');
    setFiles((prev) => [...prev, ...picked]);
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      if (kind) form.set('kind', kind);
      if (issueDate) form.set('issueDate', issueDate);
      if (issueNumber) form.set('issueNumber', issueNumber);
      if (language) form.set('language', language);
      if (genres) form.set('genres', genres);
      if (edition) form.set('edition', edition);
      for (const f of files) form.append('files', f);

      const { results } = await api.upload(form);
      const added = results.filter((r) => r.itemId && !r.duplicate).length;
      const dupes = results.filter((r) => r.duplicate).length;
      const failed = results.filter((r) => r.error);

      if (added) toast(`Added ${added} item${added === 1 ? '' : 's'} to the library.`);
      if (dupes) toast(`${dupes} file(s) were already in the library.`);
      for (const f of failed) toast(`${f.filename ?? 'File'}: ${f.error}`, 'error');
      if (added || dupes) onDone();
      else if (!failed.length) onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Add to library"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card w-full max-w-xl p-5 flex flex-col gap-4 my-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Add to library</h2>
          <button type="button" className="btn px-2 py-0.5" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            accept(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-[var(--accent)] bg-accent-soft' : 'border-rule hover:border-[var(--accent)]'
          }`}
        >
          <p className="font-medium">Drop EPUB or PDF files here</p>
          <p className="text-sm text-soft">or click to choose — you can add several at once</p>
          <input
            ref={inputRef}
            type="file"
            accept=".epub,.pdf,application/pdf,application/epub+zip"
            multiple
            className="hidden"
            onChange={(e) => accept(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm max-h-40 overflow-y-auto">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-soft text-xs shrink-0">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button
                  type="button"
                  className="text-soft hover:text-accent shrink-0"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-soft hover:text-ink">
            Classification (optional — detected from the file otherwise)
          </summary>
          <div className="grid grid-cols-2 gap-3 pt-3">
            <label className="flex flex-col gap-1">
              <span className="text-soft text-xs">Type</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as ItemKind | '')}>
                <option value="">Detect automatically</option>
                {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-soft text-xs">Language</span>
              <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">Detect automatically</option>
                <option value="en">English</option>
                <option value="ml">Malayalam</option>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
                <option value="sa">Sanskrit</option>
              </select>
            </label>
            {isPeriodical && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-soft text-xs">Issue date</span>
                  <input type="date" className="field" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-soft text-xs">Issue number</span>
                  <input className="field" value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-soft text-xs">Edition</span>
              <input className="field" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="e.g. 2nd" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-soft text-xs">Genres (comma separated)</span>
              <input className="field" value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Politics, Non-fiction" />
            </label>
          </div>
          {isPeriodical && (
            <p className="text-xs text-soft pt-2">
              The issue date groups this issue's excerpts onto their own dated page in the reading notes.
            </p>
          )}
        </details>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !files.length}>
            {busy ? 'Importing…' : `Import ${files.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
