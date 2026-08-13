import { useEffect, useState } from 'react';
import { api } from '../api';
import { Toaster, toast } from '../components/Toast';
import { languageName, type DictionaryResult } from '../types';

type Stats = Awaited<ReturnType<typeof api.dictionaryStats>>;

const SOURCE_LABELS: Record<string, string> = {
  datuk: 'Datuk (Malayalam–Malayalam)',
  sabdatharavali: 'ശബ്ദതാരാവലി (Sabdatharavali)',
  'seed-ml': 'Malayalam → English glosses',
  wordnet: 'WordNet (English)',
  oxford: 'Oxford Dictionaries',
};

export function DictionaryPage() {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState<'' | 'ml' | 'en'>('');
  const [results, setResults] = useState<DictionaryResult[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.dictionaryStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        // Try an exact lookup first; fall back to searching definition text so
        // that "birds of prey" finds vulture.
        const direct = await api.lookup(q, lang || undefined);
        if (direct.results.length) {
          setResults(direct.results);
          return;
        }
        const { results } = await api.searchDictionary(q, lang || undefined);
        setResults(results);
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, lang]);

  const totalEntries = stats?.sources.reduce((n, s) => n + s.entries, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Toaster />
      <div>
        <h1 className="text-xl font-serif">Dictionary</h1>
        <p className="text-sm text-soft">
          Look up Malayalam and English words. The same dictionaries back the popup that appears when
          you select text while reading.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="field flex-1"
          placeholder="Type a word in Malayalam or English…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <select
          className="field w-auto"
          value={lang}
          onChange={(e) => setLang(e.target.value as '' | 'ml' | 'en')}
          aria-label="Language"
        >
          <option value="">Auto</option>
          <option value="ml">Malayalam</option>
          <option value="en">English</option>
        </select>
      </div>

      {results && (
        <div className="flex flex-col gap-4">
          {results.length === 0 && <p className="text-soft">No entry found for “{q}”.</p>}
          {results.map((result, i) => (
            <article key={`${result.source}-${result.headword}-${i}`} className="card p-4 flex flex-col gap-2">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2
                  className={`text-lg font-serif ${result.lang === 'ml' ? 'ml' : ''}`}
                  lang={result.lang}
                >
                  {result.headword}
                </h2>
                <span className="text-xs text-soft">{SOURCE_LABELS[result.source] ?? result.source}</span>
                {result.match !== 'exact' && (
                  <span className="text-[10px] rounded px-1.5 py-0.5 bg-accent-soft text-accent">
                    {result.match === 'stem' ? 'root form' : 'closest match'}
                  </span>
                )}
              </div>
              <ol className="pl-5 list-decimal marker:text-soft flex flex-col gap-1">
                {result.senses.map((sense, j) => (
                  <li key={j} className="leading-snug">
                    {sense.pos && <em className="text-soft mr-1">{sense.pos}</em>}
                    {sense.definition}
                    {sense.examples?.length ? (
                      <span className="block text-soft italic text-sm mt-0.5">“{sense.examples[0]}”</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="font-medium">Installed dictionaries</h2>
        {!stats || stats.sources.length === 0 ? (
          <p className="text-sm text-soft">No dictionary data loaded.</p>
        ) : (
          <table className="text-sm w-full">
            <thead>
              <tr className="text-left text-soft border-b border-rule">
                <th className="font-normal py-1">Source</th>
                <th className="font-normal py-1">Language</th>
                <th className="font-normal py-1 text-right">Entries</th>
              </tr>
            </thead>
            <tbody>
              {stats.sources.map((s) => (
                <tr key={`${s.source}-${s.lang}`} className="border-b border-rule last:border-0">
                  <td className="py-1.5">{SOURCE_LABELS[s.source] ?? s.source}</td>
                  <td className="py-1.5">{languageName(s.lang)}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.entries.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="text-sm text-soft flex flex-col gap-1.5">
          <p>
            {totalEntries.toLocaleString()} entries loaded. Oxford API:{' '}
            {stats?.providers.oxford ? 'configured' : 'not configured'}.
          </p>
          <p>
            Malayalam and English both work offline out of the box — the dictionaries ship with
            Readit. To add ശബ്ദതാരാവലി on top, run{' '}
            <code className="text-ink">npm run import:stv</code>. See{' '}
            <code className="text-ink">docs/DICTIONARIES.md</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
