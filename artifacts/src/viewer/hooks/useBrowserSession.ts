import { useEffect } from 'react';

// WebSockets cannot report an expired browser cookie to the viewer. Check on
// return to the tab and periodically, without treating network failures as logout.
export function useBrowserSession() {
  useEffect(() => {
    let stopped = false;
    let checking = false;
    const controller = new AbortController();
    const check = async () => {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const response = await fetch('/api/browser-session', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const session = await response.json() as { required?: boolean; authenticated?: boolean };
        if (!stopped && session.required === true && session.authenticated === false) {
          const target = new URL(location.href);
          target.searchParams.delete('key');
          location.replace(`/login?returnTo=${encodeURIComponent(target.pathname + target.search + target.hash)}`);
        }
      } catch {
        // Existing connection indicators handle temporary outages.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}
