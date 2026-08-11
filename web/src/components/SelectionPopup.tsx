import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from './Toast';
import type { DictionaryResult, LookupResponse } from '../types';

export interface SelectionInfo {
  text: string;
  /** Viewport coordinates of the highlighted range. */
  rect: { top: number; bottom: number; left: number; width: number };
  /** Where in the item the selection came from, for jumping back later. */
  locator?: string;
  label?: string;
}

interface Props {
  selection: SelectionInfo;
  excerptDocId?: number;
  vocabDocId?: number;
  /** Periodical issue date, so excerpts land on the right dated page. */
  issueDate?: string | null;
  onClose: () => void;
  onSaved?: (kind: 'excerpt' | 'word') => void;
}

const POPUP_WIDTH = 380;
const MARGIN = 12;

/** Anything longer than this is treated as a passage, not a word to look up. */
const LOOKUP_WORD_LIMIT = 6;

export function SelectionPopup({
  selection,
  excerptDocId,
  vocabDocId,
  issueDate,
  onClose,
  onSaved,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'excerpt' | 'word' | null>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  const wordCount = selection.text.trim().split(/\s+/).length;
  const isPhrase = wordCount <= LOOKUP_WORD_LIMIT;

  // Look the selection up as soon as it looks like a word or short phrase.
  useEffect(() => {
    if (!isPhrase) {
      setLookup(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .lookup(selection.text)
      .then((res) => {
        if (!cancelled) setLookup(res);
      })
      .catch(() => {
        if (!cancelled) setLookup(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection.text, isPhrase]);

  // Place the popup under the selection, flipping above it when there is no
  // room below and clamping to the viewport so it is never half off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const height = el.offsetHeight;
    const { innerWidth, innerHeight } = window;

    let top = selection.rect.bottom + 8;
    if (top + height > innerHeight - MARGIN) {
      const above = selection.rect.top - height - 8;
      if (above > MARGIN) top = above;
    }
    // Clamp last and unconditionally: a selection can sit outside the viewport
    // entirely (long range, or the page scrolled after selecting), and the
    // popup must still be reachable.
    const maxTop = Math.max(MARGIN, innerHeight - height - MARGIN);
    top = Math.min(Math.max(MARGIN, top), maxTop);

    const centred = selection.rect.left + selection.rect.width / 2 - POPUP_WIDTH / 2;
    const maxLeft = Math.max(MARGIN, innerWidth - POPUP_WIDTH - MARGIN);
    const left = Math.min(Math.max(MARGIN, centred), maxLeft);
    setPos({ top, left });
  }, [selection, lookup, loading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveExcerpt = async () => {
    if (!excerptDocId) return;
    setBusy('excerpt');
    try {
      await api.addEntry(excerptDocId, {
        kind: 'excerpt',
        text: selection.text,
        sourceLabel: selection.label,
        sourceLocator: selection.locator,
        issueDate: issueDate ?? undefined,
      });
      toast('Added to reading notes.');
      onSaved?.('excerpt');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveWord = async () => {
    if (!vocabDocId) return;
    setBusy('word');
    try {
      await api.addEntry(vocabDocId, {
        kind: 'word',
        text: selection.text,
        word: selection.text,
        lang: lookup?.lang,
        meanings: lookup?.results ?? [],
        dictSource: lookup?.results[0]?.source,
        sourceLabel: selection.label,
        sourceLocator: selection.locator,
      });
      toast('Saved to the word list.');
      onSaved?.('word');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(selection.text);
      toast('Copied.');
    } catch {
      toast('Could not access the clipboard.', 'error');
    }
  };

  const isMl = lookup?.lang === 'ml';

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Selection"
      className="fixed z-50 card shadow-xl p-3 flex flex-col gap-2.5"
      style={{ top: pos.top, left: pos.left, width: POPUP_WIDTH, maxWidth: 'calc(100vw - 24px)' }}
      // Keep the underlying selection alive when interacting with the popup.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-sm leading-snug line-clamp-3 ${isMl ? 'ml' : ''}`} lang={lookup?.lang}>
          <span className="font-medium">{selection.text}</span>
        </p>
        <button type="button" onClick={onClose} className="text-soft hover:text-ink shrink-0" aria-label="Close">
          ✕
        </button>
      </div>

      {isPhrase && (
        <div className="max-h-64 overflow-y-auto -mx-1 px-1">
          {loading && <p className="text-sm text-soft">Looking up…</p>}
          {!loading && lookup && lookup.results.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {lookup.results.slice(0, 4).map((result, i) => (
                <DictionaryEntry key={`${result.source}-${result.headword}-${i}`} result={result} />
              ))}
            </ul>
          )}
          {!loading && lookup && lookup.results.length === 0 && (
            <p className="text-sm text-soft">
              {lookup.notice ?? `No dictionary entry for “${selection.text}”.`}
            </p>
          )}
        </div>
      )}

      {!isPhrase && (
        <p className="text-xs text-soft">
          {wordCount} words selected — save it as an excerpt in your reading notes.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-0.5 border-t border-rule -mx-1 px-1 pt-2.5">
        <button
          type="button"
          className="btn btn-primary text-sm py-1"
          onClick={saveExcerpt}
          disabled={!excerptDocId || busy !== null}
        >
          {busy === 'excerpt' ? 'Saving…' : 'Add to notes'}
        </button>
        {isPhrase && (
          <button
            type="button"
            className="btn text-sm py-1"
            onClick={saveWord}
            disabled={!vocabDocId || busy !== null}
            title="Copy this word and its meanings into the word list for this reading material"
          >
            {busy === 'word' ? 'Saving…' : 'Save word'}
          </button>
        )}
        <button type="button" className="btn text-sm py-1 ml-auto" onClick={copy}>
          Copy
        </button>
      </div>
    </div>
  );
}

function DictionaryEntry({ result }: { result: DictionaryResult }) {
  const isMl = result.lang === 'ml';
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`font-medium ${isMl ? 'ml' : ''}`} lang={result.lang}>
          {result.headword}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-soft">{result.source}</span>
        {result.match !== 'exact' && (
          <span className="text-[10px] rounded px-1 bg-accent-soft text-accent">
            {result.match === 'stem' ? 'root form' : 'closest match'}
          </span>
        )}
      </div>
      <ol className="flex flex-col gap-1 pl-4 list-decimal marker:text-soft">
        {result.senses.slice(0, 5).map((sense, i) => (
          <li key={i} className="text-sm leading-snug">
            {sense.pos && <em className="text-soft mr-1">{sense.pos}</em>}
            <span>{sense.definition}</span>
            {sense.examples?.length ? (
              <span className="block text-soft italic text-xs mt-0.5">“{sense.examples[0]}”</span>
            ) : null}
          </li>
        ))}
      </ol>
    </li>
  );
}
