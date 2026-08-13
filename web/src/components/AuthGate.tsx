import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';

type State = 'checking' | 'open' | 'locked';

/**
 * Readit is single-user. When READIT_PASSWORD is set on the server — which it
 * should be on any public host — this stands in front of the app until the
 * password is given. With no password configured it renders nothing of its own.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = () =>
    api
      .authStatus()
      .then((s) => setState(!s.required || s.signedIn ? 'open' : 'locked'))
      // If the status endpoint itself is unreachable, let the app through and
      // report the real failure where it happens, rather than showing a login
      // form that cannot possibly work.
      .catch(() => setState('open'));

  useEffect(() => {
    void check();
  }, []);

  // A session can expire while the tab is open; any 401 puts the gate back up.
  useEffect(() => {
    const onUnauthorised = () => setState('locked');
    window.addEventListener('readit:unauthorised', onUnauthorised);
    return () => window.removeEventListener('readit:unauthorised', onUnauthorised);
  }, []);

  if (state === 'checking') return null;
  if (state === 'open') return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      setState('open');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm flex flex-col gap-4">
        <div className="text-center">
          <div className="text-3xl" aria-hidden>
            📚
          </div>
          <h1 className="text-lg font-medium mt-1">Readit</h1>
          <p className="text-sm text-soft">Enter the password to open your library.</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="sr-only">Password</span>
          <input
            className="field"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
        </label>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary justify-center" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
