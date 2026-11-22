import { useEffect, useRef, useState } from 'react';

import { parseStoryboard, type Storyboard, type StoryboardSnapshot } from '../../shared/storyboard';
import { useStoryboardCopy } from './copy';

function loadDraft(key: string): { revision: string; storyboard: Storyboard } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (typeof value?.revision !== 'string') return null;
    const board: Storyboard = value.storyboard;
    // An unfinished draft can contain an empty name or overlapping shots.
    if (
      typeof board.title !== 'string' ||
      !board.tracks.every(
        (track) =>
          typeof track.name === 'string' &&
          track.clips.every((clip) =>
            [clip.startMs, clip.trimMs, clip.durationMs].every(Number.isSafeInteger),
          ),
      )
    )
      return null;
    const structure = {
      ...board,
      title: 'draft',
      tracks: board.tracks.map((track) => ({
        ...track,
        name: 'draft',
        clips: track.clips.map((clip, i) => ({ ...clip, startMs: i, trimMs: 0, durationMs: 1 })),
      })),
    };
    return parseStoryboard(structure) ? value : null;
  } catch {
    return null;
  }
}

export function useStoryboardDraft(url: string, initial: StoryboardSnapshot, readOnly: boolean) {
  const c = useStoryboardCopy();
  const key = 'anjian.storyboard.draft:' + url;
  const [restored] = useState(() => (readOnly ? null : loadDraft(key)));
  const [base, setBase] = useState(initial);
  const [board, setBoard] = useState(restored?.storyboard ?? initial.storyboard);
  const [draftRevision, setDraftRevision] = useState(restored?.revision ?? initial.revision);
  const [conflict, setConflict] = useState(
    Boolean(restored && restored.revision !== initial.revision),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);
  const dirty = board !== base.storyboard;

  useEffect(() => {
    if (readOnly) return;
    try {
      if (dirty)
        sessionStorage.setItem(key, JSON.stringify({ storyboard: board, revision: draftRevision }));
      else sessionStorage.removeItem(key);
    } catch {
      /* beforeunload still protects unsaved work when storage is unavailable. */
    }
  }, [board, dirty, draftRevision, key, readOnly]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(): Promise<string | null> {
    if (lockRef.current || conflict || readOnly) return null;
    if (!dirty) return base.revision;
    if (!parseStoryboard(board)) {
      setError(c.invalid);
      return null;
    }
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard: board, revision: draftRevision }),
      });
      if (response.status === 409) {
        setConflict(true);
        return null;
      }
      if (!response.ok) {
        const details = await response.json().catch(() => null);
        throw new Error(typeof details?.error === 'string' ? details.error : '');
      }
      const data: StoryboardSnapshot = await response.json();
      setBase(data);
      setDraftRevision(data.revision);
      setBoard((current) => (current === board ? data.storyboard : current));
      return data.revision;
    } catch (err) {
      setError(c.saveFailed + (err instanceof Error ? ' ' + err.message : ''));
      return null;
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    if (lockRef.current || !window.confirm(c.discard)) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(response.statusText);
      const data: StoryboardSnapshot = await response.json();
      setBase(data);
      setBoard(data.storyboard);
      setDraftRevision(data.revision);
      setConflict(false);
    } catch {
      setError(c.loadFailed);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }
  function exportDraft() {
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'timeline-draft.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  return {
    board,
    setBoard,
    base,
    save,
    reload,
    exportDraft,
    conflict,
    dirty,
    busy,
    error,
    setError,
  };
}
