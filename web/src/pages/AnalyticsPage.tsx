import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { localDay } from '../hooks/useReadingActivity';

type Report = Awaited<ReturnType<typeof api.analytics>>;
const number = (n: number) => Math.round(n).toLocaleString();
const duration = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;

export function AnalyticsPage() {
  const [days, setDays] = useState('30');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setReport(null);
    api.analytics(localDay(), days).then(r => { if (active) setReport(r); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [days, refresh]);
  const seconds = report?.daily.reduce((sum, d) => sum + d.seconds, 0) ?? 0;
  const activeDays = report?.daily.length ?? 0;
  const bars = Array.from({ length: days === '7' ? 7 : 30 }, (_, i) => {
    const date = new Date(); date.setDate(date.getDate() - ((days === '7' ? 7 : 30) - 1 - i));
    const day = localDay(date);
    return { day, seconds: report?.daily.find(d => d.day === day)?.seconds ?? 0 };
  });
  const max = Math.max(60, ...bars.map(b => b.seconds));
  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div><p className="text-xs uppercase tracking-widest text-accent mb-2">Your reading life</p><h1 className="text-3xl font-serif">Reading analytics</h1><p className="text-sm text-soft mt-2">A little perspective on the time you spend with books.</p></div>
        <label className="text-sm flex flex-col gap-1">Period<select aria-label="Period" className="field" value={days} onChange={e => setDays(e.target.value)}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label>
      </div>
      {error && <div role="alert" className="card p-4"><p>{error}</p><button className="btn mt-2" onClick={() => setRefresh(v => v + 1)}>Try again</button></div>}
      {!report && !error && <p className="text-soft">Loading your reading activity…</p>}
      {report && <>
        <section className="card p-4 flex flex-wrap items-center justify-between gap-3" aria-label="Tracking settings">
          <div><h2 className="font-medium">{report.enabled ? 'Reading tracking is on' : 'Make room for a reading habit'}</h2><p className="text-sm text-soft">{report.enabled ? 'Only active time in the reader counts. You can pause tracking at any time.' : 'Enable optional tracking to start collecting reading time. Past reading time cannot be recovered.'}</p></div>
          <button className="btn btn-primary" style={{ color: 'var(--paper)' }} disabled={busy} aria-pressed={report.enabled} onClick={async () => {
            setBusy(true); setError('');
            try { const result = await api.setAnalytics(!report.enabled); setReport({ ...report, enabled: result.enabled }); }
            catch (e) { setError((e as Error).message); }
            finally { setBusy(false); }
          }}>{busy ? 'Saving…' : report.enabled ? 'Pause tracking' : 'Enable tracking'}</button>
        </section>
        <section aria-label="Reading totals" className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Reading time', duration(seconds), 'Active time in the reader'],
            ['Estimated words read', number(seconds / 60 * 200), 'At an assumed 200 words / minute'],
            ['Books read', number(report.books.length), 'Books with tracked activity'],
            ['Current streak', `${report.streak} ${report.streak === 1 ? 'day' : 'days'}`, 'At least 1 minute daily · all time'],
          ].map(([label, value, detail]) => <div className="card p-4 sm:p-5" key={label}><p className="text-sm text-soft">{label}</p><p className="text-3xl font-serif my-3 break-words">{value}</p><p className="text-xs text-soft">{detail}</p></div>)}
        </section>
        <section className="card p-5" aria-label="Daily reading activity">
          <div className="flex flex-wrap justify-between gap-2"><h2 className="font-serif text-lg">A page at a time</h2><p className="text-sm text-soft">{days === 'all' ? 'Last 30 days shown' : `Last ${days} days`} · {activeDays} reading days in selected period</p></div>
          <div className="flex items-end gap-1 h-36 mt-6" role="img" aria-label={`Reading time over the last ${bars.length} days. Daily values are available below.`}>
            {bars.map(b => <div key={b.day} className="flex-1 min-w-0 rounded-t" style={{ backgroundColor: 'var(--accent)', height: `${Math.max(2, b.seconds / max * 100)}%`, opacity: b.seconds ? 1 : 0.12 }} title={`${b.day}: ${duration(b.seconds)}`} />)}
          </div>
          <div className="flex justify-between text-xs text-soft mt-2"><span>{bars[0].day}</span><span>Today</span></div>
          <details className="mt-4 text-sm"><summary className="cursor-pointer text-soft">Daily values</summary><div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">{bars.map(b => <p key={b.day}>{b.day}: {duration(b.seconds)}</p>)}</div></details>
          {!seconds && <p className="text-sm text-soft mt-4">Your first session starts when you enable tracking and open a book. <Link className="text-accent underline" to="/">Visit your library</Link>.</p>}
        </section>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            ['Average per reading day', duration(activeDays ? seconds / activeDays : 0)],
            ['Words saved to vocabulary', number(report.notes.words)],
            ['Excerpts saved', number(report.notes.excerpts)],
          ].map(([label, value]) => <div className="card p-4" key={label}><p className="text-sm text-soft">{label}</p><p className="text-2xl font-serif mt-2">{value}</p></div>)}
        </div>
        <section className="card p-5"><h2 className="font-serif text-lg mb-4">Time with each book</h2>
          {!report.books.length ? <p className="text-sm text-soft">No tracked reading in this period yet.</p> : <ul className="divide-y">{report.books.map(book => <li key={book.id} className="py-4 flex flex-wrap gap-3 items-center justify-between"><div className="min-w-0 flex-1"><Link to={`/item/${book.id}`} className="font-medium hover:underline break-words">{book.title}</Link><p className="text-xs text-soft mt-1">{number(book.reading_progress * 100)}% current position · {book.days} reading {book.days === 1 ? 'day' : 'days'}</p></div><div className="text-right"><p className="font-medium">{duration(book.seconds)}</p><p className="text-xs text-soft">~{number(book.seconds / 60 * 200)} words</p></div></li>)}</ul>}
        </section>
        <details className="text-sm text-soft"><summary className="cursor-pointer">How these numbers work</summary><div className="mt-3 space-y-2"><p>Time is recorded after a book opens, while its tab is visible and focused. It pauses after two minutes without a page turn, scroll, tap, or keypress. Activity inside EPUB pages counts too.</p><p>Words read are an estimate of active time × 200 words per minute, including rereading. They are not a count of words seen or understood, and scanned PDFs use the same estimate. Saved vocabulary words and excerpts are actual notebook entries.</p><p>Days follow the reading device’s calendar. A streak needs at least one minute each day and can continue from yesterday. Simultaneous reading on different devices may overlap. Tracking starts when enabled, and deleting a book also removes its activity. No third-party analytics service is used.</p></div></details>
      </>}
    </div>
  );
}
