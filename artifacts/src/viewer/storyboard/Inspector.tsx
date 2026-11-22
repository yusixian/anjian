import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  MAX_STORYBOARD_DURATION_MS,
  MAX_STORYBOARD_TITLE,
  type StoryboardClip,
  type StoryboardSnapshot,
  type StoryboardTrack,
} from '../../shared/storyboard';
import { ClipComments } from './ClipComments';
import { useStoryboardCopy } from './copy';
import { chronological } from './timeline-utils';

function TimeField({
  label,
  ms,
  minimum = 0,
  onChange,
}: {
  label: string;
  ms: number;
  minimum?: number;
  onChange: (ms: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current && Math.round(inputRef.current.valueAsNumber * 1000) !== ms)
      inputRef.current.value = String(ms / 1000);
  }, [ms]);
  return (
    <label className="sb-field">
      <span>{label}</span>
      <input
        required
        defaultValue={ms / 1000}
        max={MAX_STORYBOARD_DURATION_MS / 1000}
        min={minimum / 1000}
        ref={inputRef}
        step="0.001"
        type="number"
        onBlur={(e) => {
          if (!e.target.validity.valid) e.target.value = String(ms / 1000);
        }}
        onChange={(e) => {
          if (e.target.validity.valid) onChange(Math.round(e.target.valueAsNumber * 1000));
        }}
      />
    </label>
  );
}

export function Inspector({
  assetName,
  tracks,
  track,
  clip,
  url,
  base,
  changeTrack,
  changeClip,
  moveTrack,
  moveClip,
  removeTrack,
  removeClip,
  transfer,
}: {
  tracks: StoryboardTrack[];
  assetName: (path: string) => string;
  track?: StoryboardTrack;
  clip?: StoryboardClip;
  url: string;
  base: StoryboardSnapshot;
  changeTrack: (name: string) => void;
  changeClip: (patch: Partial<StoryboardClip>) => void;
  moveTrack: (delta: -1 | 1) => void;
  moveClip: (delta: -1 | 1) => void;
  removeTrack: () => void;
  removeClip: () => void;
  transfer: (id: string) => void;
}) {
  const c = useStoryboardCopy();
  const [comments, setComments] = useState(false);
  const ordered = chronological(track?.clips ?? []);
  const i = ordered.findIndex((item) => item.id === clip?.id);
  const trackIndex = tracks.findIndex((item) => item.id === track?.id);
  return (
    <aside aria-label={c.inspector} className="sb-inspector sb-panel">
      <header className="sb-panel-head">
        <h2>
          <SlidersHorizontal size={17} />
          {c.inspector}
        </h2>
      </header>
      <div className="sb-inspect-tabs sb-tabs">
        <button aria-pressed={!comments} type="button" onClick={() => setComments(false)}>
          {c.inspector}
        </button>
        <button aria-pressed={comments} type="button" onClick={() => setComments(true)}>
          {c.comments}
        </button>
      </div>
      {comments ? (
        clip ? (
          <ClipComments
            clipId={clip.id}
            initial={base}
            saved={base.storyboard.tracks.some((t) => t.clips.some((item) => item.id === clip.id))}
            url={url}
          />
        ) : (
          <p className="sb-empty">{c.selectClip}</p>
        )
      ) : !track ? (
        <p className="sb-empty">{c.select}</p>
      ) : (
        <div className="sb-fields">
          {clip ? (
            <>
              <strong className="sb-selection-name">{assetName(clip.asset)}</strong>
              <label className="sb-field">
                <span>{c.track}</span>
                <select value={track.id} onChange={(e) => transfer(e.target.value)}>
                  {tracks
                    .filter((other) => other.kind === track.kind)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name || c.track}
                      </option>
                    ))}
                </select>
              </label>
              <div key={clip.id}>
                <TimeField
                  label={c.start}
                  ms={clip.startMs}
                  onChange={(startMs) => changeClip({ startMs })}
                />
                <TimeField
                  label={c.trim}
                  ms={clip.trimMs}
                  onChange={(trimMs) => changeClip({ trimMs })}
                />
                <TimeField
                  label={c.duration}
                  minimum={1}
                  ms={clip.durationMs}
                  onChange={(durationMs) => changeClip({ durationMs })}
                />
              </div>
              <div className="sb-inspect-actions">
                <button
                  aria-label={c.earlier}
                  className="sb-icon"
                  disabled={i <= 0}
                  title={c.earlier}
                  type="button"
                  onClick={() => moveClip(-1)}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  aria-label={c.later}
                  className="sb-icon"
                  disabled={i >= ordered.length - 1}
                  title={c.later}
                  type="button"
                  onClick={() => moveClip(1)}
                >
                  <ArrowRight size={16} />
                </button>
                <button
                  aria-label={c.removeClip}
                  className="sb-icon sb-remove"
                  title={c.removeClip}
                  type="button"
                  onClick={removeClip}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="sb-field">
                <span>{c.trackName}</span>
                <input
                  required
                  maxLength={MAX_STORYBOARD_TITLE}
                  value={track.name}
                  onChange={(e) => changeTrack(e.target.value)}
                />
              </label>
              <div className="sb-inspect-actions">
                <button
                  aria-label={c.up}
                  className="sb-icon"
                  disabled={trackIndex <= 0}
                  title={c.up}
                  type="button"
                  onClick={() => moveTrack(-1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label={c.down}
                  className="sb-icon"
                  disabled={trackIndex === tracks.length - 1}
                  title={c.down}
                  type="button"
                  onClick={() => moveTrack(1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  aria-label={c.removeTrack}
                  className="sb-icon sb-remove"
                  title={c.removeTrack}
                  type="button"
                  onClick={removeTrack}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
