import { useCallback, useSyncExternalStore } from 'react';

import { usePageWindow } from '../ViewerContext';

export function pageLink(url: string, page: string | null): string {
  if (page === null) return url;
  const link = new URL(url);
  link.searchParams.set('page', page);
  return link.href;
}

export function usePageQuery() {
  const view = usePageWindow();
  const subscribe = useCallback(
    (notify: () => void) => {
      view.addEventListener('popstate', notify);
      view.addEventListener('anjian:pagechange', notify);
      return () => {
        view.removeEventListener('popstate', notify);
        view.removeEventListener('anjian:pagechange', notify);
      };
    },
    [view],
  );
  const search = useSyncExternalStore(subscribe, () => view.location.search);
  const query = new URLSearchParams(search);
  const write = useCallback(
    (id: string | null, replace: boolean) => {
      const url = new URL(view.location.href);
      if (!replace) {
        url.searchParams.delete('ref');
        url.searchParams.delete('board');
        url.searchParams.delete('group');
      }
      if (id === null) url.searchParams.delete('page');
      else url.searchParams.set('page', id);
      if (url.href === view.location.href) return;
      view.history[replace ? 'replaceState' : 'pushState'](view.history.state, '', url);
      view.dispatchEvent(new Event('anjian:pagechange'));
    },
    [view],
  );
  return [
    query.get('page'),
    write,
    query.get('board'),
    query.get('group'),
    query.get('ref') === '1',
  ] as const;
}
