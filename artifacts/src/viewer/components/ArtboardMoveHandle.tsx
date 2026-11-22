import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Move } from 'lucide-react';
import { useRef } from 'react';

import type { ArtboardMove, ArtboardPosition, ArtboardPositionTarget } from '../../shared/artboard-positions';
import { t } from '../i18n';

export interface ArtboardPositionEditor {
  busy: boolean;
  preview: (move: ArtboardMove | null) => void;
  save: (move: ArtboardMove) => void;
}

const styles = stylex.create({
  handle: {
    position: 'absolute',
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
    border: `1px solid ${cssVar.colorBorder}`,
    borderRadius: 8,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgContainer,
    transformOrigin: 'top left',
    touchAction: 'none',
    cursor: 'grab',
    zIndex: 6,
  },
});

const directions = new Map([
  ['ArrowLeft', [-1, 0]],
  ['ArrowRight', [1, 0]],
  ['ArrowUp', [0, -1]],
  ['ArrowDown', [0, 1]],
]);

export function ArtboardMoveHandle({
  editor, title, target, position, zoom,
}: {
  editor: ArtboardPositionEditor;
  title: string;
  target: ArtboardPositionTarget;
  position: ArtboardPosition;
  zoom: number;
}) {
  const grip = useRef<{ pointer: number; x: number; y: number; zoom: number; expected: ArtboardPosition } | null>(null);
  const move = (clientX: number, clientY: number) => {
    const start = grip.current!;
    return {
      target,
      expected: start.expected,
      x: start.expected.x + Math.round((clientX - start.x) / start.zoom),
      y: start.expected.y + Math.round((clientY - start.y) / start.zoom),
    };
  };
  const expected = { page: position.page, x: position.x, y: position.y };
  const label = t('artboardLayout.moveObject', { title });
  return (
    <button
      {...stylex.props(styles.handle)}
      aria-label={label}
      data-move-object={`${target.kind}/${target.id}`}
      disabled={editor.busy}
      style={{ left: position.x, top: position.y, transform: `scale(${1 / zoom})` }}
      title={label}
      type="button"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.button !== 0 || grip.current) return;
        const { clientX: x, clientY: y, pointerId: pointer } = event;
        grip.current = { pointer, x, y, zoom, expected };
        event.currentTarget.setPointerCapture(pointer);
      }}
      onPointerMove={(event) => {
        if (grip.current?.pointer !== event.pointerId) return;
        event.stopPropagation();
        editor.preview(move(event.clientX, event.clientY));
      }}
      onPointerUp={(event) => {
        if (grip.current?.pointer !== event.pointerId) return;
        event.stopPropagation();
        const next = move(event.clientX, event.clientY);
        grip.current = null;
        if (next.x !== next.expected.x || next.y !== next.expected.y) editor.save(next);
        else editor.preview(null);
      }}
      onLostPointerCapture={() => {
        if (!grip.current) return;
        grip.current = null;
        editor.preview(null);
      }}
      onKeyDown={(event) => {
        const direction = directions.get(event.key);
        if (!direction || grip.current) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.shiftKey ? 32 : 8;
        editor.save({
          target, expected,
          x: position.x + direction[0]! * step,
          y: position.y + direction[1]! * step,
        });
      }}
    >
      <Move aria-hidden="true" size={16} />
    </button>
  );
}
