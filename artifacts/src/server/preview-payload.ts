import fs from 'node:fs';
import path from 'node:path';

import type { CanvasPayload } from '../shared/types';
import type { ArtifactRef } from './artifacts';
import { parseDocument } from './document-codec';
import { readWhiteboardScene } from './whiteboard';

export function previewPayload(
  ref: ArtifactRef,
  dir: string,
  title: string,
  payload: unknown,
): Record<string, unknown> {
  if (ref.type === 'artboard') {
    const { canvas, layout, versions } = payload as CanvasPayload;
    return { canvas, layout, versions };
  }
  if (ref.type === 'document')
    return {
      title,
      state: parseDocument(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8')),
    };
  if (ref.type === 'whiteboard') {
    const { scene, revision } = readWhiteboardScene(dir);
    return { scene, revision };
  }
  return { title };
}
