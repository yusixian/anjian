import { useEffect } from 'react';

/** Renew opaque resource paths before sandboxed previews lose access. */
export function useContentRefresh(expiresAt: unknown, refresh: () => void) {
  useEffect(() => {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return;
    const check = () => {
      if (document.visibilityState !== 'hidden' && expiresAt - Date.now() <= 4 * 60_000) refresh();
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [expiresAt, refresh]);
}
