import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  WhiteboardComments,
  WhiteboardScene,
  WhiteboardSnapshot,
} from '../../shared/whiteboard';

export type WhiteboardCommentAction =
  | { op: 'create'; elementIds: string[]; text: string }
  | { op: 'reply'; threadId: string; text: string }
  | { op: 'status'; threadId: string; status: 'open' | 'resolved' };

type Failure = 'loadFailed' | 'saveFailed' | 'commentFailed';

const POLL_MS = 3000;

export function useWhiteboard(id: string) {
  const endpoint = `/api/whiteboard/${encodeURIComponent(id)}`;
  const viewRef = useRef<WhiteboardSnapshot | null>(null);
  const draft = useRef<{ scene: WhiteboardScene; key: string } | null>(null);
  const baseline = useRef<string | null>(null);
  const sequence = useRef(0);
  const pendingLoad = useRef<AbortController | null>(null);
  const etag = useRef<string | null>(null);
  const writing = useRef(false);
  const [view, setView] = useState<WhiteboardSnapshot | null>(null);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const show = useCallback((next: WhiteboardSnapshot) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const load = useCallback(
    async ({ discard = false, report = false }: { discard?: boolean; report?: boolean } = {}) => {
      if (writing.current || (pendingLoad.current && !report)) return;
      pendingLoad.current?.abort();
      const controller = new AbortController();
      pendingLoad.current = controller;
      const request = ++sequence.current;
      try {
        const headers = etag.current && !discard ? { 'If-None-Match': etag.current } : undefined;
        const response = await fetch(endpoint, {
          cache: 'no-store',
          headers,
          signal: controller.signal,
        });
        if (response.status === 304) {
          if (request === sequence.current && report) setFailure(null);
          return;
        }
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as WhiteboardSnapshot;
        if (request !== sequence.current) return;
        const current = viewRef.current;
        etag.current = response.headers.get('ETag');
        const locallyEdited = draft.current !== null && draft.current.key !== baseline.current;
        if (current && locallyEdited && !discard) {
          show({ ...next, scene: current.scene, title: current.title, revision: current.revision });
          setConflict(current.revision !== next.revision);
        } else {
          if (discard || current?.revision !== next.revision) {
            draft.current = null;
            baseline.current = null;
            setDirty(false);
            setGeneration((value) => value + 1);
          }
          show(
            current?.revision === next.revision && !discard
              ? { ...next, scene: current.scene }
              : next,
          );
          setConflict(false);
        }
        if (report || !current) setFailure(null);
      } catch {
        if (request === sequence.current && (report || !viewRef.current)) setFailure('loadFailed');
      } finally {
        if (pendingLoad.current === controller) pendingLoad.current = null;
      }
    },
    [endpoint, show],
  );

  useEffect(() => {
    void load();
    const sync = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    const timer = window.setInterval(sync, POLL_MS);
    document.addEventListener('visibilitychange', sync);
    return () => {
      sequence.current += 1;
      pendingLoad.current?.abort();
      pendingLoad.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const changed = useCallback((scene: WhiteboardScene, key: string) => {
    baseline.current ??= key;
    draft.current = { scene, key };
    setDirty(key !== baseline.current);
  }, []);

  async function write(
    path: string,
    body: unknown,
    apply: (value: unknown) => void,
    failed: Failure,
  ) {
    if (writing.current) return false;
    writing.current = true;
    const request = ++sequence.current;
    pendingLoad.current?.abort();
    pendingLoad.current = null;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 409 && failed === 'saveFailed') {
        if (request === sequence.current) setConflict(true);
        return false;
      }
      if (!response.ok) throw new Error(String(response.status));
      const value: unknown = await response.json();
      if (request !== sequence.current) return false;
      etag.current = null;
      apply(value);
      return true;
    } catch {
      if (request === sequence.current) setFailure(failed);
      return false;
    } finally {
      writing.current = false;
      if (request === sequence.current) setBusy(false);
    }
  }

  function save() {
    const current = viewRef.current;
    const edit = draft.current;
    if (!edit || !current) return Promise.resolve(false);
    return write(
      endpoint,
      { scene: edit.scene, revision: current.revision },
      (value) => {
        show(value as WhiteboardSnapshot);
        baseline.current = edit.key;
        setDirty(draft.current?.key !== edit.key);
        setConflict(false);
      },
      'saveFailed',
    );
  }

  function postComment(action: WhiteboardCommentAction) {
    return write(
      `${endpoint}/comments`,
      action,
      (value) => {
        const current = viewRef.current;
        if (current) show({ ...current, comments: value as WhiteboardComments });
      },
      'commentFailed',
    );
  }

  return { busy, changed, conflict, dirty, failure, generation, load, postComment, save, view };
}
