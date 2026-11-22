import type { StoryboardAsset, StoryboardClip, StoryboardTrack } from '../../shared/storyboard';

export function runningTime(tracks: StoryboardTrack[]) {
  return Math.max(
    0,
    ...tracks.flatMap((track) => track.clips.map((clip) => clip.startMs + clip.durationMs)),
  );
}

export function timecode(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return (
    [String(Math.floor(seconds / 60)).padStart(2, '0'), String(seconds % 60).padStart(2, '0')].join(
      ':',
    ) +
    '.' +
    String(ms % 1000)
      .padStart(3, '0')
      .slice(0, 2)
  );
}

export const fileName = (path: string, name?: string) => name || path.split('/').pop() || path;
export const isStill = (path: string) => /\.(?:jpe?g|png)$/i.test(path);
export const assetUrl = (base: string, path: string) =>
  base + '/assets?name=' + encodeURIComponent(path);
export const chronological = (clips: StoryboardClip[]) =>
  [...clips].sort((a, b) => a.startMs - b.startMs);

// Swap adjacent shots while preserving the gap between them and their combined end time.
export function moveClip(clips: StoryboardClip[], id: string, delta: -1 | 1) {
  const ordered = chronological(clips);
  const at = ordered.findIndex((clip) => clip.id === id);
  if (at < 0 || !ordered[at + delta]) return clips;
  const left = Math.min(at, at + delta);
  const first = ordered[left]!;
  const second = ordered[left + 1]!;
  const gap = second.startMs - first.startMs - first.durationMs;
  ordered.splice(
    left,
    2,
    { ...second, startMs: first.startMs },
    { ...first, startMs: Math.max(first.startMs, first.startMs + second.durationMs + gap) },
  );
  return ordered;
}

export function referencedMediaRevision(clips: StoryboardClip[], assets: StoryboardAsset[]) {
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const paths = [...new Set(clips.map((clip) => clip.asset))].sort();
  return JSON.stringify(
    paths.map((path) => {
      const asset = byPath.get(path);
      return [path, asset?.revision ?? asset?.bytes ?? null];
    }),
  );
}
