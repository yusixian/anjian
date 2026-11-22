import fs from 'node:fs';
import path from 'node:path';

import { publishedSlideDeck } from '../shared/slides';
import type { CanvasPayload } from '../shared/types';
import type { ArtifactRef } from './artifacts';
import { parseDocument } from './document-codec';
import { readSlideDeck } from './slides';

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
  if (ref.type === 'slides') return { deck: publishedSlideDeck(readSlideDeck(dir).deck) };
  return { title };
}
