import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function useReadingActivity(itemId: number) {
  const ready = useRef(false);
  const lastActivity = useRef(performance.now());
  const [status, setStatus] = useState('Tracking off');
  const activity = useCallback(() => { lastActivity.current = performance.now(); }, []);
  const opened = useCallback(() => { ready.current = true; activity(); }, [activity]);
  useEffect(() => {
    ready.current = false;
    let disposed = false, enabled = false, initialized = false, syncFailed = false, elapsed = 0;
    let lastTick = performance.now(), ticks = 0;
    let session = { id: crypto.randomUUID(), itemId, day: localDay(), seconds: 0 };
    const flush = () => {
      if (!enabled) return;
      const snapshot = { ...session, seconds: Math.floor(elapsed) };
      void api.readingSession(snapshot).then(result => {
        if (disposed) return;
        syncFailed = false;
        enabled = result.enabled;
        initialized = true;
        if (!enabled) setStatus('Tracking off');
      }).catch(() => { syncFailed = true; if (!disposed) setStatus('Sync pending'); });
    };
    const settings = () => {
      void api.analyticsSettings().then(result => {
        if (disposed) return;
        enabled = result.enabled;
        if (enabled) flush();
        else setStatus('Tracking off');
      }).catch(() => { if (!disposed) setStatus('Tracking unavailable'); });
    };
    settings();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = Math.min(2, (now - lastTick) / 1000);
      lastTick = now;
      if (!enabled) return;
      const day = localDay();
      if (day !== session.day) {
        flush();
        session = { id: crypto.randomUUID(), itemId, day, seconds: 0 };
        elapsed = 0; initialized = false; flush();
      }
      const active = initialized && ready.current && document.visibilityState === 'visible' && document.hasFocus() && now - lastActivity.current < 120000;
      if (active) elapsed += delta;
      setStatus(syncFailed ? 'Sync pending' : active ? 'Tracking reading' : 'Tracking paused');
      if (++ticks % 15 === 0) flush();
    }, 1000);
    const onVisibility = () => { lastTick = performance.now(); if (document.hidden) flush(); else { activity(); settings(); } };
    const onBlur = () => flush();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', settings);
    return () => {
      disposed = true; clearInterval(timer); flush();
      for (const event of events) document.removeEventListener(event, activity, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', settings);
    };
  }, [itemId, activity]);
  return { status, activity, opened };
}
