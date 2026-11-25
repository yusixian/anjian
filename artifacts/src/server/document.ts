import fs from 'node:fs';
import path from 'node:path';

import type { DocumentPayload } from '../shared/types';
import { latestMtime } from './html';

const FIRST_HEADING = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i;

const HEADING_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

function decodeHeading(value: string) {
  return value.replaceAll(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return HEADING_ENTITIES.get(name) ?? entity;
    const hex = name[1]?.toLowerCase() === 'x';
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    const valid =
      point === 9 ||
      point === 10 ||
      point === 13 ||
      (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    return valid ? String.fromCodePoint(point) : entity;
  });
}

export function readDocument(dir: string, id: string): DocumentPayload {
  let source: string;
  try {
    source = fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8');
  } catch {
    return { title: id, warnings: ['doc.xml not found'], version: latestMtime(dir) };
  }
  const heading = FIRST_HEADING.exec(source)?.[1]
    ?.replaceAll(/<[^>]+>/g, '')
    .trim();
  return {
    title: (heading && decodeHeading(heading).trim()) || id,
    warnings: [],
    version: latestMtime(dir),
  };
}
