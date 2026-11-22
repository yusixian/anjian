import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_SLIDE_DECK_BYTES,
  parseSlideDeck,
  SLIDE_DECK_FILE,
  type SlideDeck,
} from '../shared/slides';

export class SlideDeckError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function defaultSlideDeck(title: string, slideTitle = ''): SlideDeck {
  return { slides: [{ body: '', id: 'opening', notes: '', title: slideTitle }], title, version: 1 };
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const revisionOf = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });

function sourcePath(dir: string) {
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) throw new SlideDeckError(404, 'Slide deck not found');
  return path.join(dir, SLIDE_DECK_FILE);
}

export function readSlideDeck(dir: string) {
  const file = sourcePath(dir);
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if (isMissing(error))
      return { bytes: 0, deck: defaultSlideDeck(path.basename(dir)), revision: 'empty' };
    if ((error as NodeJS.ErrnoException).code === 'ELOOP')
      throw new SlideDeckError(422, 'Unsafe slide deck source');
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new SlideDeckError(422, 'Unsafe slide deck source');
    if (stat.size > MAX_SLIDE_DECK_BYTES) throw new SlideDeckError(413, 'Slide deck is too large');
    const contents = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < contents.length) {
      const count = fs.readSync(fd, contents, bytes, contents.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== stat.size)
      throw new SlideDeckError(409, 'Slide deck changed while being read. Retry shortly.');
    const source = contents.subarray(0, bytes);
    let deck: SlideDeck | null = null;
    try {
      deck = parseSlideDeck(JSON.parse(utf8.decode(source)));
    } catch {
      // Leave malformed source text available for recovery.
    }
    if (!deck) throw new SlideDeckError(422, 'deck.json is not a valid slide deck');
    return { bytes, deck, revision: revisionOf(source) };
  } finally {
    fs.closeSync(fd);
  }
}

export function writeSlideDeck(
  dir: string,
  deck: SlideDeck,
  expectedRevision: string,
  admit?: (bytes: number) => void,
) {
  const file = sourcePath(dir);
  const check = () => {
    const current = readSlideDeck(dir);
    if (current.revision !== expectedRevision)
      throw new SlideDeckError(409, 'Slide deck changed on disk. Reload before saving.');
    return current;
  };
  const previous = check();
  const data = `${JSON.stringify(deck, null, 2)}\n`;
  const bytes = Buffer.byteLength(data);
  if (bytes > MAX_SLIDE_DECK_BYTES) throw new SlideDeckError(413, 'Slide deck is too large');
  admit?.(bytes - previous.bytes);
  const temporary = path.join(dir, `.${SLIDE_DECK_FILE}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    check();
    if (previous.revision === 'empty') {
      try {
        fs.linkSync(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new SlideDeckError(409, 'Slide deck changed on disk. Reload before saving.');
      }
    } else fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { bytes, deck, revision: revisionOf(data) };
}
