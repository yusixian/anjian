import { type AnchorSpec, type CommentsFile, isObject } from './comments';

export const STORYBOARD_FILE = 'timeline.json';
export const MAX_STORYBOARD_ASSET_BYTES = 24 * 1024 * 1024;
export const MAX_STORYBOARD_ASSETS = 256;
export const MAX_STORYBOARD_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_STORYBOARD_TIMELINE_BYTES = 128 * 1024;
export const MAX_STORYBOARD_TRACKS = 8;
export const MAX_STORYBOARD_CLIPS = 32;
export const MAX_STORYBOARD_DURATION_MS = 300_000;
export const MAX_STORYBOARD_TITLE = 160;

export type StoryboardTrackKind = 'video' | 'audio';

export interface StoryboardAsset {
  bytes: number;
  kind: StoryboardTrackKind;
  name?: string;
  path: string;
  revision?: string;
}

export interface StoryboardClip {
  asset: string;
  durationMs: number;
  id: string;
  startMs: number;
  trimMs: number;
}

export interface StoryboardTrack {
  clips: StoryboardClip[];
  id: string;
  kind: StoryboardTrackKind;
  name: string;
}

export interface Storyboard {
  title: string;
  tracks: StoryboardTrack[];
  version: 1;
}

export interface StoryboardAnchor {
  clipId: string;
}

export type StoryboardComments = CommentsFile<StoryboardAnchor>;

export interface StoryboardSnapshot {
  assets: StoryboardAsset[];
  comments: StoryboardComments;
  commentsWarning?: string;
  listening: boolean;
  revision: string;
  storyboard: Storyboard;
}

export interface StoryboardJob {
  error?: string;
  id: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
}

const VISUAL_ASSETS = new Set(['mp4', 'webm', 'png', 'jpg', 'jpeg']);
const AUDIO_ASSETS = new Set(['wav', 'mp3', 'm4a']);

export function isStoryboardId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function storyboardAssetKind(value: unknown): StoryboardTrackKind | null {
  if (typeof value !== 'string') return null;
  const ext = /^assets\/[a-z0-9][a-z0-9-]{0,95}\.([a-z0-9]+)$/.exec(value)?.[1];
  if (!ext) return null;
  if (VISUAL_ASSETS.has(ext)) return 'video';
  if (AUDIO_ASSETS.has(ext)) return 'audio';
  return null;
}

export const storyboardAnchors: AnchorSpec<StoryboardAnchor> = {
  missing: 'Clip not found',
  read(value) {
    if (!isObject(value) || !isStoryboardId(value.clipId)) return null;
    return { clipId: value.clipId };
  },
  same: (a, b) => a.clipId === b.clipId,
};

function validTitle(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_STORYBOARD_TITLE && !!value.trim();
}

function validTime(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_STORYBOARD_DURATION_MS
  );
}

function parseClip(value: unknown, kind: StoryboardTrackKind): StoryboardClip | null {
  if (!isObject(value)) return null;
  const { asset, durationMs, id, startMs, trimMs } = value;
  if (
    !isStoryboardId(id) ||
    typeof asset !== 'string' ||
    storyboardAssetKind(asset) !== kind ||
    !validTime(startMs) ||
    !validTime(trimMs) ||
    !validTime(durationMs) ||
    durationMs === 0 ||
    startMs + durationMs > MAX_STORYBOARD_DURATION_MS ||
    trimMs + durationMs > MAX_STORYBOARD_DURATION_MS
  )
    return null;
  return { asset, durationMs, id, startMs, trimMs };
}

export function parseStoryboard(value: unknown): Storyboard | null {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    !validTitle(value.title) ||
    !Array.isArray(value.tracks) ||
    value.tracks.length > MAX_STORYBOARD_TRACKS
  )
    return null;
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const tracks: StoryboardTrack[] = [];
  for (const entry of value.tracks) {
    if (
      !isObject(entry) ||
      !isStoryboardId(entry.id) ||
      trackIds.has(entry.id) ||
      !validTitle(entry.name) ||
      (entry.kind !== 'video' && entry.kind !== 'audio') ||
      !Array.isArray(entry.clips) ||
      entry.clips.length + clipIds.size > MAX_STORYBOARD_CLIPS
    )
      return null;
    trackIds.add(entry.id);
    const clips: StoryboardClip[] = [];
    for (const raw of entry.clips) {
      const clip = parseClip(raw, entry.kind);
      if (!clip || clipIds.has(clip.id)) return null;
      clipIds.add(clip.id);
      clips.push(clip);
    }
    clips.sort((a, b) => a.startMs - b.startMs);
    if (
      clips.some((clip, index) => {
        const next = clips[index + 1];
        return next && clip.startMs + clip.durationMs > next.startMs;
      })
    )
      return null;
    tracks.push({ clips, id: entry.id, kind: entry.kind, name: entry.name.trim() });
  }
  return { title: value.title.trim(), tracks, version: 1 };
}

export function storyboardDuration(storyboard: Storyboard): number {
  return Math.max(
    0,
    ...storyboard.tracks.flatMap(({ clips }) =>
      clips.map(({ startMs, durationMs }) => startMs + durationMs),
    ),
  );
}

export function missingStoryboardAsset(storyboard: Storyboard, files: ReadonlySet<string>) {
  return storyboard.tracks.flatMap(({ clips }) => clips).find(({ asset }) => !files.has(asset))
    ?.asset;
}
