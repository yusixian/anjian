import { useEffect, useMemo, useState } from 'react';

import {
  SELECTION_LIMITS,
  SELECTION_MAX_OBJECTS,
  type SelectedArtboardObject,
} from '../../shared/selection';
import type { CanvasSpec } from '../../shared/types';

const EMPTY: SelectedArtboardObject[] = [];

export function useArtboardObjectSelection(
  canvas: CanvasSpec | null,
  page: string | null,
  enabled: boolean,
) {
  const [selection, setSelection] = useState(EMPTY);
  const [revision, setRevision] = useState(0);
  const objects = useMemo(() => {
    if (!enabled || !canvas || !page) return EMPTY;
    return selection.filter(({ id, kind, page: selectedPage }) => {
      const items = kind === 'board' ? canvas.boards : canvas.notes;
      const item = items && Object.hasOwn(items, id) ? items[id] : undefined;
      return item?.page === page && selectedPage === page &&
        (kind === 'board' || ('kind' in item && item.kind === kind));
    });
  }, [canvas, enabled, page, selection]);
  useEffect(() => {
    if (objects.length !== selection.length) setSelection(objects);
  }, [objects, selection.length]);

  function toggle(object: SelectedArtboardObject) {
    if (object.id.length > SELECTION_LIMITS.id || object.page.length > SELECTION_LIMITS.id) return;
    const index = objects.findIndex(({ id, kind }) => id === object.id && kind === object.kind);
    if (index < 0 && objects.length >= SELECTION_MAX_OBJECTS) return;
    setSelection(index < 0 ? [...objects, object] : objects.filter((_, i) => index !== i));
    setRevision((value) => value + 1);
  }
  return { objects, revision, toggle };
}
