import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';

import type { BoardSpec, ConnectionSpec, Rect } from '../../shared/types';

const styles = stylex.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'visible',
    pointerEvents: 'none',
  },
  label: {
    fontFamily: cssVar.fontFamily,
    fontWeight: 600,
  },
});

function boundaryPoint(board: Rect, dx: number, dy: number) {
  const ratio = Math.min(board.w / (2 * Math.abs(dx)), board.h / (2 * Math.abs(dy)));
  return {
    x: board.x + board.w / 2 + dx * ratio,
    y: board.y + board.h / 2 + dy * ratio,
  };
}

export function CanvasConnections({
  boards,
  connections,
  zoom,
}: {
  boards: [string, BoardSpec][];
  connections: Record<string, ConnectionSpec>;
  zoom: number;
}) {
  const marker = useId();
  const pageBoards = new Map(boards);
  const labelSize = Math.max(14, 11 / zoom);
  const arrowSize = Math.max(8, 5 / zoom);
  return (
    <svg height="1" width="1" {...stylex.props(styles.layer)}>
      <defs>
        <marker
          id={marker}
          markerHeight={arrowSize}
          markerWidth={arrowSize}
          markerUnits="userSpaceOnUse"
          orient="auto"
          refX="8"
          refY="4"
          viewBox="0 0 8 8"
        >
          <path d="M0 0 L8 4 L0 8 Z" fill={cssVar.colorTextSecondary} />
        </marker>
      </defs>
      {Object.entries(connections).map(([id, { from, to, label }]) => {
        const source = pageBoards.get(from);
        const target = pageBoards.get(to);
        if (!source || !target || source === target) return null;
        const dx = target.x + target.w / 2 - (source.x + source.w / 2);
        const dy = target.y + target.h / 2 - (source.y + source.h / 2);
        if (dx === 0 && dy === 0) return null;
        const start = boundaryPoint(source, dx, dy);
        const end = boundaryPoint(target, -dx, -dy);
        if ((end.x - start.x) * dx + (end.y - start.y) * dy <= 0) return null;
        return (
          <g
            aria-label={`${source.title || from} → ${target.title || to} · ${label}`}
            data-connection={id}
            key={id}
            role="img"
          >
            <line
              markerEnd={`url(#${marker})`}
              stroke={cssVar.colorTextSecondary}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              x1={start.x}
              x2={end.x}
              y1={start.y}
              y2={end.y}
            />
            <text
              {...stylex.props(styles.label)}
              fill={cssVar.colorText}
              fontSize={labelSize}
              paintOrder="stroke"
              stroke={cssVar.colorBgContainer}
              strokeLinejoin="round"
              strokeWidth={labelSize * 0.42}
              textAnchor="middle"
              x={(start.x + end.x) / 2}
              y={(start.y + end.y) / 2 - labelSize * 0.4}
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
