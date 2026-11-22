import { useEffect, useMemo, useRef } from 'react';

import type { SelectedArtboardObject, SelectionMessage } from '../../shared/selection';
import type { BoardSpec } from '../../shared/types';
import { buildSelectionState, fitSelectionMessage } from '../lib/selection';
import type { Inspector } from './useInspector';

const TAB = crypto.randomUUID();
const EMPTY_INSPECTOR = { frames: {}, selectedTargets: [], details: {}, revision: 0 };

interface Options {
  artifact: string | null;
  boards: Record<string, BoardSpec> | undefined;
  inspector?: Pick<Inspector, 'frames' | 'selectedTargets' | 'details' | 'revision'>;
  objects?: SelectedArtboardObject[];
  objectRevision?: number;
  live: boolean | undefined;
  send: ((message: SelectionMessage) => void) | undefined;
}

export function useSelectionSync({
  artifact, boards, live, inspector = EMPTY_INSPECTOR, objects, objectRevision = 0, send,
}: Options) {
  const sentRevision = useRef({ nodes: 0, objects: 0 });
  const { frames, selectedTargets, details, revision } = inspector;
  const targetKey = JSON.stringify(selectedTargets.map(({ boardId, id }) => [boardId, id]));
  const targets = useMemo(() => JSON.parse(targetKey) as [string, number][], [targetKey]);
  const state = useMemo(
    () =>
      buildSelectionState({
        boards: boards ?? {},
        frames,
        targets: targets.map(([boardId, id]) => ({ boardId, id })),
        details,
      }),
    [boards, frames, targets, details],
  );
  useEffect(() => {
    if (!artifact || !send || !live) return;
    const timer = setTimeout(() => {
      const human = revision !== sentRevision.current.nodes ||
        objectRevision !== sentRevision.current.objects;
      sentRevision.current = { nodes: revision, objects: objectRevision };
      send(fitSelectionMessage({
        type: 'selection', artifact, tab: TAB, human, ...state, ...(objects ? { objects } : {}),
      }));
    }, 100);
    return () => clearTimeout(timer);
  }, [artifact, send, live, state, revision, objects, objectRevision]);
}
