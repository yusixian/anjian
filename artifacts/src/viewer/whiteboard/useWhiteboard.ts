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

type Failure = 'loadFailed' | 'saveFailed' | 'commentFailed' | 'pageSaveFailed';

interface SceneEdit {
  key: string;
  scene: WhiteboardScene;
}

interface PageDraft {
  baseline: string;
  edit: SceneEdit;
  revision: string;
}

interface SaveReceipt {
  before: string;
  revision: string;
  submitted: string;
}

export function createWhiteboardDrafts() {
  const pages = new Map<string, PageDraft>();
  const listeners = new Map<string, (receipt: SaveReceipt) => void>();
  const receipts = new Map<string, SaveReceipt>();
  const pending = new Map<string, SceneEdit>();
  return {
    pages,
    pending,
    listen(page: string, listener: (receipt: SaveReceipt) => void) {
      listeners.set(page, listener);
      const receipt = receipts.get(page);
      if (receipt) listener(receipt);
      return () => {
        if (listeners.get(page) === listener) listeners.delete(page);
      };
    },
    confirm(page: string, receipt: SaveReceipt) {
      receipts.set(page, receipt);
      const draft = pages.get(page);
      if (draft?.revision === receipt.before) {
        if (draft.edit.key === receipt.submitted) pages.delete(page);
        else pages.set(page, { ...draft, baseline: receipt.submitted, revision: receipt.revision });
      }
      listeners.get(page)?.(receipt);
    },
  };
}

export type WhiteboardDrafts = ReturnType<typeof createWhiteboardDrafts>;

const POLL_MS = 3000;

export function useWhiteboard(id: string, page: string, drafts: WhiteboardDrafts) {
  const endpoint = `/api/whiteboard/${encodeURIComponent(id)}`;
  const query = `?${new URLSearchParams({ page })}`;
  const sceneEndpoint = `${endpoint}${query}`;
  const initialDraft = drafts.pages.get(page);
  const viewRef = useRef<WhiteboardSnapshot | null>(null);
  const draftRef = useRef<SceneEdit | null>(initialDraft?.edit ?? null);
  const baselineRef = useRef<string | null>(initialDraft?.baseline ?? null);
  const revisionRef = useRef<string | null>(initialDraft?.revision ?? null);
  const latestRemoteRevision = useRef<string | null>(null);
  const sequence = useRef(0);
  const pendingLoad = useRef<AbortController | null>(null);
  const etag = useRef<string | null>(null);
  const writing = useRef(false);
  const [view, setView] = useState<WhiteboardSnapshot | null>(null);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(() => initialDraft !== undefined);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const show = useCallback((next: WhiteboardSnapshot) => {
    revisionRef.current = next.revision;
    viewRef.current = next;
    setView(next);
  }, []);

  const trackDraft = useCallback(() => {
    const edit = draftRef.current;
    const baseline = baselineRef.current;
    const revision = revisionRef.current;
    const sending = drafts.pending.get(page);
    const changed =
      !!edit && (edit.key !== baseline || (sending !== undefined && sending.key !== edit.key));
    if (changed && baseline !== null && revision !== null)
      drafts.pages.set(page, { edit, baseline, revision });
    else drafts.pages.delete(page);
    setDirty(changed);
  }, [drafts, page]);

  const load = useCallback(
    async ({ discard = false, report = false }: { discard?: boolean; report?: boolean } = {}) => {
      if (writing.current || (pendingLoad.current && !report)) return;
      pendingLoad.current?.abort();
      const controller = new AbortController();
      pendingLoad.current = controller;
      const request = ++sequence.current;
      try {
        const headers = etag.current && !discard ? { 'If-None-Match': etag.current } : undefined;
        const response = await fetch(sceneEndpoint, {
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
        latestRemoteRevision.current = next.revision;
        const draft = draftRef.current;
        const revision = revisionRef.current;
        const sending = drafts.pending.get(page);
        const locallyEdited =
          draft &&
          (draft.key !== baselineRef.current ||
            (sending !== undefined && sending.key !== draft.key));
        if (locallyEdited && revision !== null && !discard) {
          show({ ...next, scene: current?.scene ?? draft.scene, revision });
          setConflict(revision !== next.revision);
        } else {
          if (discard || current?.revision !== next.revision) {
            draftRef.current = null;
            baselineRef.current = null;
            trackDraft();
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
    [drafts, page, sceneEndpoint, show, trackDraft],
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

  useEffect(
    () =>
      drafts.listen(page, (receipt) => {
        if (revisionRef.current !== receipt.before) return;
        const current = viewRef.current;
        const remoteRevision = writing.current ? receipt.revision : latestRemoteRevision.current;
        const edit = draftRef.current;
        const needsRebase = edit && (edit.key !== baselineRef.current || drafts.pending.has(page));
        if (needsRebase) {
          revisionRef.current = receipt.revision;
          baselineRef.current = receipt.submitted;
          latestRemoteRevision.current = remoteRevision;
          if (current) show({ ...current, revision: receipt.revision });
          trackDraft();
          setConflict(
            edit.key !== receipt.submitted &&
              remoteRevision !== null &&
              remoteRevision !== receipt.before &&
              remoteRevision !== receipt.revision,
          );
        }
        etag.current = null;
        if (!writing.current) void load({ report: true });
      }),
    [drafts, load, page, show, trackDraft],
  );

  const changed = useCallback(
    (scene: WhiteboardScene, key: string) => {
      baselineRef.current ??= key;
      draftRef.current = { scene, key };
      trackDraft();
    },
    [trackDraft],
  );

  async function write<T>(
    path: string,
    body: unknown,
    apply: (value: T, active: boolean) => void,
    failed: Failure,
  ): Promise<T | null> {
    if (writing.current) return null;
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
        return null;
      }
      if (!response.ok) throw new Error(String(response.status));
      const value = (await response.json()) as T;
      const active = request === sequence.current;
      if (active) etag.current = null;
      apply(value, active);
      return active ? value : null;
    } catch {
      if (request === sequence.current) setFailure(failed);
      return null;
    } finally {
      writing.current = false;
      if (request === sequence.current) setBusy(false);
    }
  }

  async function save() {
    const current = viewRef.current;
    const edit = draftRef.current;
    if (writing.current || drafts.pending.has(page) || !edit || !current) return false;
    drafts.pending.set(page, edit);
    const saved = await write<WhiteboardSnapshot>(
      sceneEndpoint,
      { scene: edit.scene, revision: current.revision },
      (value, active) => {
        drafts.confirm(page, {
          before: current.revision,
          revision: value.revision,
          submitted: edit.key,
        });
        if (active) show(value);
      },
      'saveFailed',
    );
    if (drafts.pending.get(page) === edit) drafts.pending.delete(page);
    return saved !== null;
  }

  async function postComment(action: WhiteboardCommentAction) {
    const saved = await write<WhiteboardComments>(
      `${endpoint}/comments`,
      action.op === 'create' ? { ...action, page } : action,
      (value, active) => {
        const current = viewRef.current;
        if (active && current) show({ ...current, comments: value });
      },
      'commentFailed',
    );
    return saved !== null;
  }

  function savePage(title: string, rename: boolean) {
    return write<WhiteboardSnapshot>(
      `${endpoint}/pages`,
      rename ? { page, title } : { title },
      (value, active) => {
        const current = viewRef.current;
        if (active && rename && current) show({ ...current, pages: value.pages });
      },
      'pageSaveFailed',
    );
  }

  return {
    busy,
    changed,
    conflict,
    dirty,
    failure,
    generation,
    load,
    postComment,
    save,
    savePage,
    view,
  };
}
