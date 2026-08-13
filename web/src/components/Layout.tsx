import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { api } from '../api';

type Theme = 'light' | 'dark' | 'system';

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('readit-theme') as Theme | null) ?? 'system',
  );
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('readit-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

const NAV = [
  { to: '/', label: 'Library', end: true },
  { to: '/dictionary', label: 'Dictionary', end: false },
];

export function Layout() {
  const [theme, setTheme] = useTheme();
  const [canSignOut, setCanSignOut] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setCanSignOut(s.required && s.signedIn))
      .catch(() => {});
  }, []);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const icon: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-paper-blur backdrop-blur border-b border-rule">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden>📚</span>
            <span>Readit</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg transition-colors ${
                    isActive ? 'bg-accent-soft text-accent font-medium' : 'text-soft hover:text-ink'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          {canSignOut && (
            <button
              type="button"
              className="ml-auto btn px-2.5 py-1 text-sm"
              onClick={async () => {
                await api.logout().catch(() => {});
                window.location.reload();
              }}
            >
              Sign out
            </button>
          )}
          <button
            type="button"
            onClick={() => setTheme(next[theme])}
            className={`${canSignOut ? '' : 'ml-auto'} btn px-2.5 py-1 text-sm`}
            title={`Theme: ${theme}. Click to switch.`}
            aria-label={`Theme: ${theme}. Click to switch.`}
          >
            <span aria-hidden>{icon[theme]}</span>
          </button>
        </div>
      </header>
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
