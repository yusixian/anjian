import { AudioLines, Film, ListVideo, Plus } from 'lucide-react';
import { useState } from 'react';

import type { StoryboardClip, StoryboardTrack } from '../../shared/storyboard';
import { useStoryboardCopy } from './copy';
import { chronological, runningTime, timecode } from './timeline-utils';

export type Selection = { trackId: string; clipId?: string };

function clipRows(clips: StoryboardClip[]) {
  const ends: number[] = [];
  return chronological(clips).map((clip) => {
    const available = ends.findIndex((end) => end <= clip.startMs);
    const row = available < 0 ? ends.length : available;
    ends[row] = clip.startMs + clip.durationMs;
    return { clip, row };
  });
}

export function Timeline({
  assetName,
  tracks,
  selection,
  onSelect,
  onAdd,
  full,
}: {
  tracks: StoryboardTrack[];
  assetName: (path: string) => string;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onAdd: (kind: StoryboardTrack['kind']) => void;
  full: boolean;
}) {
  const c = useStoryboardCopy();
  const [kind, setKind] = useState<StoryboardTrack['kind']>('video');
  const duration = runningTime(tracks);
  const step = [1000, 2000, 5000, 10000, 30000, 60000].find((v) => duration <= v * 8) ?? 60000;
  const steps = Math.max(5, Math.ceil(duration / step));
  const scale = step * steps;
  return (
    <section aria-label={c.timeline} className="sb-timeline sb-panel">
      <header className="sb-panel-head">
        <h2>
          <ListVideo size={17} />
          {c.timeline}
        </h2>
        <div className="sb-tools">
          <select
            aria-label={c.newTrack}
            value={kind}
            onChange={(e) => setKind(e.target.value as StoryboardTrack['kind'])}
          >
            <option value="video">{c.video}</option>
            <option value="audio">{c.audio}</option>
          </select>
          <button className="sb-button" disabled={full} type="button" onClick={() => onAdd(kind)}>
            <Plus size={15} />
            {c.addTrack}
          </button>
        </div>
      </header>
      <div aria-label={c.timeline} className="sb-timeline-scroll" role="region" tabIndex={0}>
        <div className="sb-lanes">
          <div className="sb-track-meta sb-track-count">
            {tracks.length} {c.track}
          </div>
          <div aria-hidden="true" className="sb-ruler">
            {Array.from({ length: steps + 1 }, (_, n) => (
              <span key={n} style={{ left: (n / steps) * 100 + '%' }}>
                {timecode(n * step).split('.')[0]}
              </span>
            ))}
          </div>
          {tracks.map((track) => {
            const rows = clipRows(track.clips);
            const Icon = track.kind === 'audio' ? AudioLines : Film;
            return (
              <div className="sb-track-row" data-kind={track.kind} key={track.id}>
                <button
                  aria-pressed={selection?.trackId === track.id && !selection.clipId}
                  className="sb-track-meta sb-track-button"
                  type="button"
                  onClick={() => onSelect({ trackId: track.id })}
                >
                  <Icon size={16} />
                  <span>{track.name || c.track}</span>
                </button>
                <div
                  className="sb-lane"
                  style={{
                    height: Math.max(1, ...rows.map((r) => r.row + 1)) * 40 + 12,
                    backgroundSize: 100 / steps + '% 100%',
                  }}
                >
                  {!rows.length && <span className="sb-empty-lane">{c.noClips}</span>}
                  {rows.map(({ clip, row }) => (
                    <button
                      aria-pressed={selection?.clipId === clip.id}
                      className="sb-block"
                      key={clip.id}
                      title={assetName(clip.asset) + ' · ' + timecode(clip.durationMs)}
                      type="button"
                      aria-label={
                        assetName(clip.asset) +
                        ' · ' +
                        timecode(clip.startMs) +
                        ' – ' +
                        timecode(clip.startMs + clip.durationMs)
                      }
                      style={{
                        left: (clip.startMs / scale) * 100 + '%',
                        width: (clip.durationMs / scale) * 100 + '%',
                        top: 6 + row * 40,
                      }}
                      onClick={() => onSelect({ trackId: track.id, clipId: clip.id })}
                    >
                      <Icon size={13} />
                      <span>{assetName(clip.asset)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!tracks.length && <p className="sb-empty">{c.emptyTimeline}</p>}
    </section>
  );
}
