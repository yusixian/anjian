import fs from 'node:fs';
import path from 'node:path';

import { publishedSlideDeck } from '../shared/slides';
import type { CanvasPayload } from '../shared/types';
import { WHITEBOARD_DEFAULT_PAGE } from '../shared/whiteboard';
import type { ArtifactRef } from './artifacts';
import { parseDocument } from './document-codec';
import { readSlideDeck } from './slides';
import { readWhiteboardPages, readWhiteboardScene } from './whiteboard';

export function previewPayload(
  ref: ArtifactRef,
  dir: string,
  title: string,
  payload: unknown,
  requestedPage = WHITEBOARD_DEFAULT_PAGE,
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
  if (ref.type === 'slides') return { deck: publishedSlideDeck(readSlideDeck(dir).deck) };
  if (ref.type === 'whiteboard') {
    const pageMissing = !readWhiteboardPages(dir).some(({ id }) => id === requestedPage);
    const page = pageMissing ? WHITEBOARD_DEFAULT_PAGE : requestedPage;
    const { scene, revision } = readWhiteboardScene(dir, page);
    return { scene, revision, page, pageMissing };
  }
  return { title };
}
