import type { CanvasSpec } from './types';

export type ArtboardPositionTarget = { kind: 'board' | 'note'; id: string };
export type ArtboardPosition = { page: string; x: number; y: number };
export type ArtboardMove = {
  target: ArtboardPositionTarget;
  expected: ArtboardPosition;
  x: number;
  y: number;
};
export type ArtboardPositions = Record<string, ArtboardPosition>;

export function artboardPosition(canvas: CanvasSpec, { kind, id }: ArtboardPositionTarget) {
  const entries = kind === 'board' ? canvas.boards : canvas.notes;
  return entries && Object.hasOwn(entries, id) ? entries[id] : undefined;
}

export function applyArtboardPositions(canvas: CanvasSpec, positions: ArtboardPositions) {
  const project = <T extends ArtboardPosition>(kind: ArtboardPositionTarget['kind'], items: Record<string, T>) =>
    Object.fromEntries(Object.entries(items).map(([id, item]) => {
      const position = positions[`${kind}/${id}`];
      return [id, position?.page === item.page ? { ...item, x: position.x, y: position.y } : item];
    }));
  return {
    ...canvas,
    boards: project('board', canvas.boards),
    ...(canvas.notes ? { notes: project('note', canvas.notes) } : {}),
  };
}
