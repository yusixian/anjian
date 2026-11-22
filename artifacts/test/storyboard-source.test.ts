import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultStoryboard,
  listStoryboardAssets,
  openStoryboardAsset,
  readStoryboard,
  uploadStoryboardAsset,
  writeStoryboard,
} from '../src/server/storyboard-source';
import {
  MAX_STORYBOARD_ASSET_BYTES,
  MAX_STORYBOARD_TIMELINE_BYTES,
} from '../src/shared/storyboard';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YwAAAABJRU5ErkJggg==',
  'base64',
);
let root: string;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-test-storyboard-source-'));
  dir = path.join(root, 'storyboard', 'review');
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('storyboard sources', () => {
  it('saves with an optimistic revision, reports the storage delta and preserves later disk edits', () => {
    const timeline = defaultStoryboard('Storyboard');
    expect(readStoryboard(dir)).toMatchObject({ revision: 'empty', bytes: 0 });
    const admit = vi.fn();
    const saved = writeStoryboard(dir, timeline, 'empty', admit);
    expect(admit).toHaveBeenCalledWith(saved.bytes);
    expect(readStoryboard(dir)).toEqual({
      bytes: saved.bytes,
      revision: saved.revision,
      storyboard: timeline,
    });
    expect(() => writeStoryboard(dir, timeline, 'empty')).toThrow('Storyboard changed on disk');

    const external = JSON.stringify({ ...timeline, title: 'External edit' });
    const file = path.join(dir, 'timeline.json');
    expect(() =>
      writeStoryboard(dir, { ...timeline, title: 'New title' }, saved.revision, () => {
        fs.writeFileSync(file, external);
      }),
    ).toThrow('Storyboard changed on disk');
    expect(fs.readFileSync(file, 'utf8')).toBe(external);
    expect(fs.readdirSync(dir)).toEqual(['timeline.json']);
  });

  it('assigns managed upload names, rejects mislabeled and missing media and charges only published bytes', () => {
    const admit = vi.fn();
    const asset = uploadStoryboardAsset(dir, 'C:\\fakepath\\分镜演员.png', png, admit);
    expect(asset).toMatchObject({ bytes: png.length, kind: 'video', name: '分镜演员.png' });
    expect(asset.path).toMatch(/^assets\/n-[\da-f-]+\.png$/);
    expect(admit).toHaveBeenCalledWith(png.length);
    expect(listStoryboardAssets(dir)).toEqual([asset]);
    fs.appendFileSync(path.join(dir, asset.path), 'change');
    const [modified] = listStoryboardAssets(dir);
    expect(modified?.name).toBe(asset.name);
    expect(modified?.revision).not.toBe(asset.revision);

    const timeline = defaultStoryboard('Storyboard');
    timeline.tracks[0]!.clips.push({
      asset: asset.path,
      durationMs: 500,
      id: 'still',
      startMs: 0,
      trimMs: 0,
    });
    const { revision } = writeStoryboard(dir, timeline, 'empty');
    expect(() => uploadStoryboardAsset(dir, 'attack.png', Buffer.from('<html>'))).toThrow(
      'Unsupported storyboard media',
    );
    expect(() =>
      uploadStoryboardAsset(dir, 'another.png', png, () => {
        throw new Error('Quota exceeded');
      }),
    ).toThrow('Quota exceeded');
    expect(listStoryboardAssets(dir)).toEqual([modified]);
    fs.unlinkSync(path.join(dir, asset.path));
    expect(() => writeStoryboard(dir, timeline, revision)).toThrow(
      'Missing or invalid storyboard media',
    );
    expect(readStoryboard(dir).revision).toBe(revision);
  });

  it('rejects root, timeline and media symlinks and oversized source files', () => {
    const media = path.join(root, 'sample.png');
    fs.writeFileSync(media, png);
    fs.symlinkSync(media, path.join(dir, 'timeline.json'));
    expect(() => readStoryboard(dir)).toThrow('Unsafe storyboard timeline');
    fs.unlinkSync(path.join(dir, 'timeline.json'));
    fs.writeFileSync(path.join(dir, 'timeline.json'), '');
    fs.truncateSync(path.join(dir, 'timeline.json'), MAX_STORYBOARD_TIMELINE_BYTES + 1);
    expect(() => readStoryboard(dir)).toThrow('Storyboard timeline is too large');

    fs.mkdirSync(path.join(dir, 'assets'));
    fs.symlinkSync(media, path.join(dir, 'assets', 'outside.png'));
    expect(() => openStoryboardAsset(dir, 'assets/outside.png')).toThrow(
      'Storyboard media not found',
    );
    expect(() => openStoryboardAsset(dir, 'assets/../timeline.json')).toThrow(
      'Storyboard media not found',
    );
    const large = path.join(dir, 'assets', 'large.png');
    fs.writeFileSync(large, png);
    fs.truncateSync(large, MAX_STORYBOARD_ASSET_BYTES + 1);
    expect(() => openStoryboardAsset(dir, 'assets/large.png')).toThrow(
      'Storyboard media is too large',
    );

    fs.symlinkSync(path.join(root, 'storyboard'), path.join(root, 'alias'));
    expect(() => readStoryboard(path.join(root, 'alias', 'review'))).toThrow(
      'Storyboard not found',
    );
  });
});
