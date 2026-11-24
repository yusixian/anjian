import type { ArtifactReference } from './artifact-reference';
import { NAME_STRIP_H } from './geometry';
import type { Bounds, CanvasLayout, CanvasSpec } from './types';

export function resolveReferenceFocus(
  canvas: CanvasSpec,
  layout: CanvasLayout,
  focus: NonNullable<ArtifactReference['focus']>,
): { page: string; bounds: Bounds } | null {
  const { id, kind } = focus;
  if (kind === 'block') return null;
  if (kind === 'board') {
    if (!Object.hasOwn(canvas.boards, id)) return null;
    const board = canvas.boards[id]!;
    if (!canvas.pages.some((page) => page.id === board.page)) return null;
    return {
      page: board.page,
      bounds: {
        minX: board.x,
        minY: board.y - NAME_STRIP_H,
        maxX: board.x + board.w,
        maxY: board.y + board.h,
      },
    };
  }
  for (const { id: page } of canvas.pages) {
    const groups = layout.pages[page]?.groups;
    if (!groups || !Object.hasOwn(groups, id)) continue;
    const rect = groups[id]!;
    return {
      page,
      bounds: { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h },
    };
  }
  return null;
}
