import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveReferenceFocus } from '../../shared/reference-focus';
import type { Bounds, CanvasLayout, CanvasSpec } from '../../shared/types';
import { resolveFocus } from '../lib/view';
import { usePageQuery } from './usePageQuery';

interface Options {
  canvas: CanvasSpec | null | undefined;
  fitPage: (page: string, bounds?: Bounds) => boolean;
  layout: CanvasLayout | null | undefined;
  startAtFocus?: boolean;
}

export function useArtboardPage({ canvas, layout, fitPage, startAtFocus = false }: Options) {
  const [page, setPage] = useState<string | null>(null);
  const pendingFit = useRef<string | null>(null);
  const initialized = useRef(false);
  const focusedBounds = useRef<Bounds | undefined>(undefined);
  const seenFocus = useRef<string | null>(null);
  const [requested, writePage, board, group, strict] = usePageQuery();
  const focus = useMemo(() => {
    if (!canvas || !layout) return null;
    if (board && group === null)
      return resolveReferenceFocus(canvas, layout, { id: board, kind: 'board' });
    if (group && board === null)
      return resolveReferenceFocus(canvas, layout, { id: group, kind: 'group' });
    return null;
  }, [canvas, layout, board, group]);
  const focusUnavailable = Boolean(
    strict && (board !== null || group !== null) && canvas && layout && !focus,
  );
  const seenRequested = useRef(requested);
  const selectPage = useCallback(
    (id: string | null, replace = true) => {
      setPage(id);
      pendingFit.current = id;
      seenRequested.current = id;
      writePage(id, replace);
    },
    [writePage],
  );

  useEffect(() => {
    if (!canvas || !layout) return;
    const firstPage = canvas.pages[0]?.id ?? null;
    const valid = (id: string | null | undefined) =>
      id && canvas.pages.some((p) => p.id === id) ? id : null;

    const focusKey = focus ? JSON.stringify([board, group, focus.page]) : null;
    if (focus && seenFocus.current !== focusKey) {
      initialized.current = true;
      seenFocus.current = focusKey;
      focusedBounds.current = focus.bounds;
      selectPage(focus.page);
      return;
    }
    seenFocus.current = focusKey;
    if (!initialized.current) {
      initialized.current = true;
      const focused =
        startAtFocus && canvas.focus
          ? resolveFocus(canvas, layout, canvas.focus.target)?.page
          : undefined;
      const start =
        valid(requested) ??
        (requested !== null
          ? firstPage
          : (valid(focused) ?? valid(canvas.activePage) ?? firstPage));
      selectPage(start);
      return;
    }

    if (requested !== seenRequested.current) {
      selectPage(valid(requested) ?? firstPage);
      return;
    }

    // Agent updates supply opening defaults; navigation and the camera belong to this viewer.
    if (!page || !canvas.pages.some((p) => p.id === page)) {
      selectPage(firstPage);
    }
  }, [canvas, layout, page, startAtFocus, requested, board, group, focus, selectPage]);

  useEffect(() => {
    if (pendingFit.current === null || pendingFit.current !== page) return;
    const fitted = focusedBounds.current ? fitPage(page, focusedBounds.current) : fitPage(page);
    if (!fitted) return;
    focusedBounds.current = undefined;
    pendingFit.current = null;
  });

  const changePage = (id: string) => {
    if (canvas?.pages.some((p) => p.id === id)) selectPage(id, false);
  };

  return { page, changePage, focusUnavailable };
}
