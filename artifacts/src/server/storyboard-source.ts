import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isArtifactAddress } from '../shared/ids';
import {
  MAX_STORYBOARD_ASSET_BYTES,
  MAX_STORYBOARD_ASSETS,
  MAX_STORYBOARD_SOURCE_BYTES,
  MAX_STORYBOARD_TIMELINE_BYTES,
  MAX_STORYBOARD_TITLE,
  parseStoryboard,
  type Storyboard,
  STORYBOARD_FILE,
  type StoryboardAsset,
  storyboardAssetKind,
} from '../shared/storyboard';
import type { CommentAdmission } from './document-comments';

export class StoryboardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const safeRead = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encodedName = /^n-((?:[0-9a-f]{2}){1,36})-[0-9a-f]{10}(\.[a-z0-9]+)$/;
const invalidNameCharacters = /[\p{Cc}\p{Cf}\\/]/u;

export function defaultStoryboard(
  title: string,
  labels = { video: '视频', audio: '音频' },
): Storyboard {
  return {
    title: title.trim().slice(0, MAX_STORYBOARD_TITLE) || '分镜',
    tracks: [
      { clips: [], id: 'video', kind: 'video', name: labels.video },
      { clips: [], id: 'audio', kind: 'audio', name: labels.audio },
    ],
    version: 1,
  };
}

const revisionOf = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function canonicalDir(dir: string) {
  const parent = fs.lstatSync(path.dirname(dir), { throwIfNoEntry: false });
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!parent?.isDirectory() || !stat?.isDirectory())
    throw new StoryboardError(404, 'Storyboard not found');
  return fs.realpathSync(dir);
}

export function storyboardIdentity(dir: string) {
  const file = path.join(canonicalDir(dir), '.artifact-id');
  let fd: number;
  try {
    fd = fs.openSync(file, safeRead);
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? ''))
      throw new StoryboardError(422, 'Invalid storyboard identity');
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 64)
      throw new StoryboardError(422, 'Invalid storyboard identity');
    const contents = Buffer.alloc(65);
    const bytes = fs.readSync(fd, contents, 0, contents.length, 0);
    const identity = contents.toString('utf8', 0, bytes).trim();
    if (!isArtifactAddress(identity)) throw new StoryboardError(422, 'Invalid storyboard identity');
    return identity;
  } finally {
    fs.closeSync(fd);
  }
}

export function readStoryboard(dir: string) {
  const file = path.join(canonicalDir(dir), STORYBOARD_FILE);
  let fd: number;
  try {
    fd = fs.openSync(file, safeRead);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT')
      return { storyboard: defaultStoryboard(path.basename(dir)), revision: 'empty', bytes: 0 };
    if (code === 'ELOOP') throw new StoryboardError(422, 'Unsafe storyboard timeline');
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new StoryboardError(422, 'Unsafe storyboard timeline');
    if (stat.size > MAX_STORYBOARD_TIMELINE_BYTES)
      throw new StoryboardError(413, 'Storyboard timeline is too large');
    const contents = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < contents.length) {
      const count = fs.readSync(fd, contents, bytes, contents.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes !== stat.size || fs.fstatSync(fd).ctimeMs !== stat.ctimeMs)
      throw new StoryboardError(
        409,
        'Storyboard timeline changed while being read. Retry shortly.',
      );
    const source = contents.subarray(0, bytes);
    let storyboard: Storyboard | null = null;
    try {
      storyboard = parseStoryboard(JSON.parse(utf8.decode(source)));
    } catch {
      // Malformed source stays on disk for recovery.
    }
    if (!storyboard) throw new StoryboardError(422, 'timeline.json is not a valid storyboard');
    return { storyboard, revision: revisionOf(source), bytes };
  } finally {
    fs.closeSync(fd);
  }
}

function mediaMatches(relative: string, header: Buffer): boolean {
  switch (path.extname(relative)) {
    case '.mp4':
    case '.m4a': {
      return header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp';
    }
    case '.webm': {
      return header.length >= 4 && header.readUInt32BE() === 0x1a45dfa3;
    }
    case '.png': {
      return header
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    case '.jpg':
    case '.jpeg': {
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    }
    case '.wav': {
      return (
        ['RIFF', 'RF64'].includes(header.toString('ascii', 0, 4)) &&
        header.toString('ascii', 8, 12) === 'WAVE'
      );
    }
    case '.mp3': {
      return (
        header.toString('ascii', 0, 3) === 'ID3' ||
        (header.length >= 2 && header[0] === 0xff && (header[1]! & 0xe0) === 0xe0)
      );
    }
    default: {
      return false;
    }
  }
}

function assetDir(dir: string, create = false) {
  const target = path.join(canonicalDir(dir), 'assets');
  if (create) {
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory() || fs.realpathSync(target) !== target)
    throw new StoryboardError(422, 'Unsafe storyboard asset directory');
  return target;
}

function displayName(relative: string) {
  const match = encodedName.exec(path.basename(relative));
  if (!match) return null;
  try {
    const stem = utf8.decode(Buffer.from(match[1]!, 'hex'));
    return stem && !invalidNameCharacters.test(stem) ? `${stem}${match[2]}` : null;
  } catch {
    return null;
  }
}

function uploadPath(originalName: string) {
  const { ext, name } = path.parse(originalName.replaceAll('\\', '/'));
  let stem = '';
  let bytes = 0;
  for (const character of name.trim()) {
    if (invalidNameCharacters.test(character)) continue;
    bytes += Buffer.byteLength(character);
    if (bytes > 36) break;
    stem += character;
  }
  const encoded = Buffer.from(stem.trim() || 'media').toString('hex');
  const nonce = randomUUID().replaceAll('-', '').slice(0, 10);
  return `assets/n-${encoded}-${nonce}${ext.toLowerCase()}`;
}

function assetMetadata(
  relative: string,
  kind: StoryboardAsset['kind'],
  stat: fs.Stats,
): StoryboardAsset {
  const name = displayName(relative);
  const revision = revisionOf(
    `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
  );
  return { bytes: stat.size, kind, ...(name ? { name } : {}), path: relative, revision };
}

export function openStoryboardAsset(dir: string, relative: string) {
  const kind = storyboardAssetKind(relative);
  if (!kind) throw new StoryboardError(404, 'Storyboard media not found');
  const assets = assetDir(dir);
  if (!assets) throw new StoryboardError(404, 'Storyboard media not found');
  const file = path.join(assets, path.basename(relative));
  let fd: number;
  try {
    fd = fs.openSync(file, safeRead);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ELOOP')
      throw new StoryboardError(404, 'Storyboard media not found');
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !stat.size || fs.realpathSync(file) !== file)
      throw new StoryboardError(404, 'Storyboard media not found');
    if (stat.size > MAX_STORYBOARD_ASSET_BYTES)
      throw new StoryboardError(413, 'Storyboard media is too large');
    const header = Buffer.alloc(12);
    const count = fs.readSync(fd, header, 0, header.length, 0);
    if (!mediaMatches(relative, header.subarray(0, count)))
      throw new StoryboardError(422, 'Storyboard media does not match its file type');
    return { asset: assetMetadata(relative, kind, stat), fd, file, stat };
  } catch (error) {
    fs.closeSync(fd);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new StoryboardError(404, 'Storyboard media not found');
    throw error;
  }
}

export function listStoryboardAssets(dir: string): StoryboardAsset[] {
  const directory = assetDir(dir);
  if (!directory) return [];
  const assets: StoryboardAsset[] = [];
  const entries = fs.opendirSync(directory);
  try {
    for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
      const relative = `assets/${entry.name}`;
      if (!entry.isFile() || !storyboardAssetKind(relative)) continue;
      try {
        const { asset, fd } = openStoryboardAsset(dir, relative);
        fs.closeSync(fd);
        assets.push(asset);
      } catch (error) {
        if (!(error instanceof StoryboardError)) throw error;
      }
      if (assets.length > MAX_STORYBOARD_ASSETS)
        throw new StoryboardError(413, 'Storyboard has too many media files');
    }
  } finally {
    entries.closeSync();
  }
  return assets.sort((a, b) => a.path.localeCompare(b.path));
}

function checkSourceSize(timelineBytes: number, assets: StoryboardAsset[], added = 0) {
  const bytes = assets.reduce((sum, asset) => sum + asset.bytes, timelineBytes + added);
  if (bytes > MAX_STORYBOARD_SOURCE_BYTES)
    throw new StoryboardError(413, 'Storyboard source exceeds 32 MiB');
}

export function writeStoryboard(
  dir: string,
  storyboard: Storyboard,
  expectedRevision: string,
  admit?: CommentAdmission,
) {
  const file = path.join(canonicalDir(dir), STORYBOARD_FILE);
  const check = () => {
    const current = readStoryboard(dir);
    if (current.revision !== expectedRevision)
      throw new StoryboardError(409, 'Storyboard changed on disk. Reload before saving.');
    return current;
  };
  const previous = check();
  const data = `${JSON.stringify(storyboard, null, 2)}\n`;
  const bytes = Buffer.byteLength(data);
  if (bytes > MAX_STORYBOARD_TIMELINE_BYTES)
    throw new StoryboardError(413, 'Storyboard timeline is too large');
  const assets = listStoryboardAssets(dir);
  const available = new Set(assets.map((asset) => asset.path));
  for (const { clips } of storyboard.tracks) {
    for (const clip of clips) {
      if (!available.has(clip.asset))
        throw new StoryboardError(422, `Missing or invalid storyboard media: ${clip.asset}`);
    }
  }
  checkSourceSize(bytes, assets);
  admit?.(bytes - previous.bytes);
  const temporary = path.join(path.dirname(file), `.${STORYBOARD_FILE}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    check();
    if (previous.revision === 'empty') {
      try {
        fs.linkSync(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new StoryboardError(409, 'Storyboard changed on disk. Reload before saving.');
      }
    } else fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { assets, bytes, revision: revisionOf(data), storyboard };
}

export function uploadStoryboardAsset(
  dir: string,
  originalName: string,
  data: Buffer,
  admit?: CommentAdmission,
): StoryboardAsset {
  const relative = uploadPath(originalName);
  const kind = storyboardAssetKind(relative);
  if (!kind || !mediaMatches(relative, data.subarray(0, 12)))
    throw new StoryboardError(415, 'Unsupported storyboard media');
  if (data.length > MAX_STORYBOARD_ASSET_BYTES)
    throw new StoryboardError(413, 'Storyboard media is too large');
  const { bytes } = readStoryboard(dir);
  const assets = listStoryboardAssets(dir);
  if (assets.length >= MAX_STORYBOARD_ASSETS)
    throw new StoryboardError(413, 'Storyboard has too many media files');
  checkSourceSize(bytes, assets, data.length);
  admit?.(data.length);
  const directory = assetDir(dir, true)!;
  const file = path.join(directory, path.basename(relative));
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
    fs.linkSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return assetMetadata(relative, kind, fs.lstatSync(file));
}
