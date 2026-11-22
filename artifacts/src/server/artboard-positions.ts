import fs from 'node:fs';
import path from 'node:path';

import type { ArtboardMove, ArtboardPosition, ArtboardPositions } from '../shared/artboard-positions';
import { isObject } from '../shared/comments';

export function artboardPositionsFile(dir: string) {
  return path.resolve(dir, '../../.state/artboard', path.basename(dir), 'manual-layout.json');
}

function isPosition(value: unknown): value is ArtboardPosition {
  return isObject(value) &&
    typeof value.page === 'string' &&
    typeof value.x === 'number' && Number.isFinite(value.x) &&
    typeof value.y === 'number' && Number.isFinite(value.y);
}

export function readArtboardPositions(file: string): ArtboardPositions {
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error('Unsafe artboard layout state');
    const stored: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(stored) || !Object.values(stored).every(isPosition))
      throw new Error('Invalid artboard layout state');
    return stored as ArtboardPositions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export function parseArtboardMove(value: unknown): ArtboardMove | null {
  if (!isObject(value) || !isObject(value.target) ||
      (value.target.kind !== 'board' && value.target.kind !== 'note') ||
      typeof value.target.id !== 'string' || !value.target.id ||
      !isPosition(value.expected) ||
      typeof value.x !== 'number' || !Number.isFinite(value.x) ||
      typeof value.y !== 'number' || !Number.isFinite(value.y)) return null;
  return {
    target: { kind: value.target.kind, id: value.target.id },
    expected: value.expected,
    x: value.x,
    y: value.y,
  };
}
