import { Check, Clapperboard, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { mintArtifactId } from '../../shared/ids';
import {
  MAX_STORYBOARD_CLIPS,
  MAX_STORYBOARD_DURATION_MS,
  MAX_STORYBOARD_TITLE,
  MAX_STORYBOARD_TRACKS,
  type StoryboardAsset,
  type StoryboardClip,
  storyboardDuration,
  type StoryboardSnapshot,
  type StoryboardTrack,
} from '../../shared/storyboard';
import { CommentRecovery } from '../comments/CommentRecovery';
import { LibraryLink, LibraryNavigation } from '../components/LibraryNavigation';
import { NativeFeedback, NativeFeedbackButton } from '../feedback/NativeFeedback';
import { useStoryboardCopy } from './copy';
import { Inspector } from './Inspector';
import { MediaBin } from './MediaBin';
import { Monitor } from './Monitor';
import { type Selection, Timeline } from './Timeline';
import {
  fileName,
  moveClip as reorderClip,
  referencedMediaRevision,
  runningTime,
  timecode,
} from './timeline-utils';
import { useStoryboardDraft } from './useStoryboardDraft';

function Workbench({
  id,
  url,
  initial,
  readOnly,
}: {
  id: string;
  url: string;
  initial: StoryboardSnapshot;
  readOnly: boolean;
}) {
  const c = useStoryboardCopy();
  const draft = useStoryboardDraft(url, initial, readOnly);
  const { board, setBoard, base } = draft;
  const first = board.tracks.find((t) => t.clips.length) ?? board.tracks[0];
  const [selection, setSelection] = useState<Selection | null>(
    first ? { trackId: first.id, clipId: first.clips[0]?.id } : null,
  );
  const [commentRevision, setCommentRevision] = useState(0);
  const [comments, setComments] = useState(false);
  const [imported, setImported] = useState<StoryboardAsset[]>([]);
  const [source, setSource] = useState<string | undefined>(
    first?.clips[0]?.asset ?? base.assets[0]?.path,
  );
  const [sourceVersion, setSourceVersion] = useState(0);
  const durationsRef = useRef(new Map<string, number>());
  const assets = [
    ...new Map([...imported, ...base.assets].map((item) => [item.path, item])).values(),
  ];
  const assetName = (path: string) =>
    fileName(path, assets.find((item) => item.path === path)?.name);
  const selectedTrack = board.tracks.find((t) => t.id === selection?.trackId);
  const selectedClip = selectedTrack?.clips.find((clip) => clip.id === selection?.clipId);
  const asset = assets.find((item) => item.path === source);
  const duration = storyboardDuration(board);
  const clips = board.tracks.flatMap((t) => t.clips);
  const blocked = draft.conflict || draft.busy;

  function pickSource(item: StoryboardAsset) {
    setSource(item.path);
    setSourceVersion((n) => n + 1);
  }
  function select(value: Selection) {
    setSelection(value);
    if (value.clipId) {
      const clip = board.tracks
        .find((t) => t.id === value.trackId)
        ?.clips.find((v) => v.id === value.clipId);
      if (clip) {
        setSource(clip.asset);
        setSourceVersion((n) => n + 1);
      }
    }
  }
  function updateTrack(next: StoryboardTrack) {
    setBoard({ ...board, tracks: board.tracks.map((t) => (t.id === next.id ? next : t)) });
    draft.setError('');
  }
  function makeTrack(kind: StoryboardTrack['kind']): StoryboardTrack {
    return {
      id: 't-' + mintArtifactId().toLowerCase(),
      kind,
      name: c[kind] + ' ' + (board.tracks.filter((t) => t.kind === kind).length + 1),
      clips: [],
    };
  }
  function addTrack(kind: StoryboardTrack['kind']) {
    if (board.tracks.length >= MAX_STORYBOARD_TRACKS) return;
    const track = makeTrack(kind);
    setBoard({ ...board, tracks: [...board.tracks, track] });
    setSelection({ trackId: track.id });
    draft.setError('');
  }
  function addClip(item: StoryboardAsset, measured?: number) {
    let track =
      selectedTrack?.kind === item.kind
        ? selectedTrack
        : board.tracks.find((t) => t.kind === item.kind);
    if (
      clips.length >= MAX_STORYBOARD_CLIPS ||
      (!track && board.tracks.length >= MAX_STORYBOARD_TRACKS)
    ) {
      draft.setError(c.addFailed);
      return false;
    }
    const tracks = [...board.tracks];
    if (!track) {
      track = makeTrack(item.kind);
      tracks.push(track);
    }
    const startMs = runningTime([track]);
    const durationMs = Math.min(
      measured ?? durationsRef.current.get(item.path) ?? 3000,
      MAX_STORYBOARD_DURATION_MS - startMs,
    );
    if (durationMs < 1) {
      draft.setError(c.addFailed);
      return false;
    }
    const clip: StoryboardClip = {
      id: 'c-' + mintArtifactId().toLowerCase(),
      asset: item.path,
      startMs,
      durationMs,
      trimMs: 0,
    };
    setBoard({
      ...board,
      tracks: tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)),
    });
    setSelection({ trackId: track.id, clipId: clip.id });
    pickSource(item);
    draft.setError('');
    return true;
  }
  function moveTrack(delta: -1 | 1) {
    if (!selectedTrack) return;
    const tracks = [...board.tracks];
    const index = tracks.indexOf(selectedTrack);
    if (!tracks[index + delta]) return;
    tracks.splice(index, 1);
    tracks.splice(index + delta, 0, selectedTrack);
    setBoard({ ...board, tracks });
  }
  function transfer(id: string) {
    if (!selectedTrack || !selectedClip || id === selectedTrack.id) return;
    const target = board.tracks.find((t) => t.id === id && t.kind === selectedTrack.kind);
    if (!target) return;
    const startMs = target.clips.some(
      (other) =>
        other.startMs < selectedClip.startMs + selectedClip.durationMs &&
        selectedClip.startMs < other.startMs + other.durationMs,
    )
      ? runningTime([target])
      : selectedClip.startMs;
    if (startMs + selectedClip.durationMs > MAX_STORYBOARD_DURATION_MS) {
      draft.setError(c.addFailed);
      return;
    }
    setBoard({
      ...board,
      tracks: board.tracks.map((t) =>
        t === selectedTrack
          ? { ...t, clips: t.clips.filter((v) => v !== selectedClip) }
          : t === target
            ? { ...t, clips: [...t.clips, { ...selectedClip, startMs }] }
            : t,
      ),
    });
    setSelection({ trackId: target.id, clipId: selectedClip.id });
    draft.setError('');
  }
  const monitor = (
    <Monitor
      asset={asset}
      canRender={!!clips.length && !blocked}
      clip={selectedClip?.asset === source ? selectedClip : undefined}
      dirty={draft.dirty}
      duration={duration}
      mediaRevision={referencedMediaRevision(clips, assets)}
      readOnly={readOnly}
      revision={base.revision}
      save={draft.save}
      sourceVersion={sourceVersion}
      url={url}
      onDuration={(path, ms) => durationsRef.current.set(path, ms)}
    />
  );
  const editor = (
    <main
      className={'sb-root' + (readOnly ? ' sb-readonly' : '')}
      onKeyDown={(event) => {
        if (!readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void draft.save();
        }
      }}
    >
      <header className="sb-toolbar">
        <LibraryLink />
        <span className="sb-toolbar-rule" />
        <span className="sb-type">
          <Clapperboard size={15} />
          {c.storyboard}
        </span>
        {readOnly ? (
          <h1 className="sb-title">{board.title}</h1>
        ) : (
          <input
            required
            aria-label={c.title}
            className="sb-title"
            maxLength={MAX_STORYBOARD_TITLE}
            value={board.title}
            onChange={(e) => setBoard({ ...board, title: e.target.value })}
          />
        )}
        {!readOnly && (
          <div className="sb-toolbar-actions">
            <NativeFeedbackButton />
            <CommentRecovery
              url={url + '/comments'}
              onRestore={() => setCommentRevision((value) => value + 1)}
            />
            <span className="sb-save-state" role="status">
              {!draft.dirty && <Check size={14} />}{' '}
              {draft.busy ? c.saving : draft.dirty ? c.dirty : c.saved}
            </span>
            <button
              className="sb-button"
              disabled={!draft.dirty || blocked}
              type="button"
              onClick={() => void draft.save()}
            >
              <Save size={15} />
              {c.save}
            </button>
          </div>
        )}
      </header>
      {draft.conflict && (
        <div className="sb-banner" role="alert">
          {c.conflict}{' '}
          <button type="button" onClick={draft.exportDraft}>
            {c.exportDraft}
          </button>
          <button disabled={draft.busy} type="button" onClick={() => void draft.reload()}>
            {c.reload}
          </button>
        </div>
      )}
      {draft.error && (
        <div className="sb-banner" role="alert">
          {draft.error}
        </div>
      )}
      {readOnly ? (
        monitor
      ) : (
        <div className="sb-workbench" inert={draft.busy ? true : undefined}>
          <MediaBin
            assets={assets}
            narration={board.narration}
            narrationAvailable={base.narrationAvailable}
            selected={source}
            url={url}
            onAdd={addClip}
            onNarrationChange={(narration) => setBoard({ ...board, narration })}
            onImport={(item) => {
              setImported((items) => [...items, item]);
              pickSource(item);
            }}
            onSelect={(item) => {
              pickSource(item);
              if (selectedTrack) setSelection({ trackId: selectedTrack.id });
            }}
          />
          {monitor}
          <Inspector
            assetName={assetName}
            base={base}
            changeTrack={(name) => selectedTrack && updateTrack({ ...selectedTrack, name })}
            clip={selectedClip}
            commentRevision={commentRevision}
            comments={comments}
            moveTrack={moveTrack}
            setComments={setComments}
            track={selectedTrack}
            tracks={board.tracks}
            transfer={transfer}
            url={url}
            changeClip={(patch) =>
              selectedTrack &&
              selectedClip &&
              updateTrack({
                ...selectedTrack,
                clips: selectedTrack.clips.map((clip) =>
                  clip === selectedClip ? { ...clip, ...patch } : clip,
                ),
              })
            }
            moveClip={(delta) =>
              selectedTrack &&
              selectedClip &&
              updateTrack({
                ...selectedTrack,
                clips: reorderClip(selectedTrack.clips, selectedClip.id, delta),
              })
            }
            removeClip={() => {
              if (selectedTrack && selectedClip) {
                updateTrack({
                  ...selectedTrack,
                  clips: selectedTrack.clips.filter((clip) => clip !== selectedClip),
                });
                setSelection({ trackId: selectedTrack.id });
              }
            }}
            removeTrack={() => {
              if (!selectedTrack || (selectedTrack.clips.length && !window.confirm(c.confirmTrack)))
                return;
              const tracks = board.tracks.filter((t) => t !== selectedTrack);
              setBoard({ ...board, tracks });
              setSelection(tracks.length ? { trackId: tracks[0]!.id } : null);
            }}
          />
          <Timeline
            assetName={assetName}
            full={board.tracks.length >= MAX_STORYBOARD_TRACKS}
            selection={selection}
            tracks={board.tracks}
            onAdd={addTrack}
            onSelect={select}
          />
          <footer className="sb-footer">
            <span>
              {c.durationLabel} <b>{timecode(duration)}</b>
            </span>
            <span>
              {c.tracksCount} <b>{board.tracks.length}</b>
            </span>
          </footer>
        </div>
      )}
    </main>
  );
  if (readOnly) return editor;
  return (
    <NativeFeedback<StoryboardSnapshot>
      id={id}
      type="storyboard"
      locate={(snapshot, threadId) => {
        const clipId = snapshot.comments.threads.find((thread) => thread.id === threadId)?.anchor
          .clipId;
        const current = draft.dirty || draft.busy ? board : snapshot.storyboard;
        const track = current.tracks.find((item) => item.clips.some((clip) => clip.id === clipId));
        const clip = track?.clips.find((item) => item.id === clipId);
        if (
          !track ||
          !clip ||
          !snapshot.storyboard.tracks.some((item) => item.clips.some((item) => item.id === clipId))
        )
          return false;
        if (!draft.dirty && !draft.busy) draft.adoptSnapshot(snapshot);
        setSelection({ trackId: track.id, clipId: clip.id });
        setSource(clip.asset);
        setSourceVersion((version) => version + 1);
        setComments(true);
        return true;
      }}
    >
      {editor}
    </NativeFeedback>
  );
}

function Load({ id, readOnly }: { id: string; readOnly: boolean }) {
  const c = useStoryboardCopy();
  const url = '/api/storyboard/' + encodeURIComponent(id);
  const [initial, setInitial] = useState<StoryboardSnapshot>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: abort.signal });
        if (!res.ok) throw new Error(res.statusText);
        const data: StoryboardSnapshot = await res.json();
        if (!abort.signal.aborted) setInitial(data);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => abort.abort();
  }, [url, attempt]);
  if (initial) return <Workbench id={id} initial={initial} readOnly={readOnly} url={url} />;
  return (
    <main className="sb-root sb-loading">
      <LibraryLink />
      <p role={failed ? 'alert' : 'status'}>{failed ? c.loadFailed : c.load}</p>
      {failed && (
        <button
          className="sb-button"
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          {c.retry}
        </button>
      )}
    </main>
  );
}
export function StoryboardLayout({ id, readOnly = false }: { id: string; readOnly?: boolean }) {
  return (
    <LibraryNavigation>
      <Load id={id} key={id + readOnly} readOnly={readOnly} />
    </LibraryNavigation>
  );
}
