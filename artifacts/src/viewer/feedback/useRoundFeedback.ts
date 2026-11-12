import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type FeedbackConnection,
  FeedbackError,
  type FeedbackRoundInput,
  type FeedbackTask,
  type RoundSubmissionIntent,
} from './api';
import { useOptionalFeedbackApi } from './FeedbackProvider';

const storageKey = (artifact: string) => `anjian.feedback.round.${artifact}`;
function restore(artifact: string | null): RoundSubmissionIntent | null {
  if (!artifact) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(artifact)) ?? 'null');
    return value &&
      typeof value.connectionId === 'string' &&
      typeof value.submissionKey === 'string' &&
      typeof value.round?.id === 'string' &&
      typeof value.round.version === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Round dispatch stays separate from comment selection and never writes legacy submit markers. */
export function useRoundFeedback(artifact: string | null) {
  const api = useOptionalFeedbackApi(artifact);
  const [connections, setConnections] = useState<FeedbackConnection[]>([]);
  const [rounds, setRounds] = useState<FeedbackRoundInput[]>([]);
  const [tasks, setTasks] = useState<FeedbackTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState(() => restore(artifact));
  const pending = useRef(intent);
  const lock = useRef(false);
  const active = useRef(true);
  const reads = useRef(0);
  const [target, setTarget] = useState(intent?.connectionId ?? '');
  const saveIntent = useCallback(
    (next: RoundSubmissionIntent | null) => {
      if (!artifact) return;
      try {
        if (next) sessionStorage.setItem(storageKey(artifact), JSON.stringify(next));
        else sessionStorage.removeItem(storageKey(artifact));
      } catch {
        if (next) throw new FeedbackError(0, 'storage_unavailable');
      }
      pending.current = next;
      if (active.current) setIntent(next);
    },
    [artifact],
  );
  const report = (failure: unknown) => {
    if (active.current)
      setError(
        failure instanceof FeedbackError
          ? failure.code === 'storage_unavailable'
            ? 'storage'
            : failure.code === 'feedback_changed'
              ? 'changed'
              : failure.status === 401 ||
                  failure.status === 403 ||
                  failure.code === 'connection_unauthorized'
                ? 'authorization'
                : failure.status === 409
                  ? 'conflict'
                  : 'failed'
          : 'network',
      );
  };
  const refresh = useCallback(async () => {
    if (!api) return false;
    const request = ++reads.current;
    try {
      const [nextConnections, nextInput, nextTasks] = await Promise.all([
        api.connections(),
        api.input(),
        api.tasks(),
      ]);
      if (!active.current || request !== reads.current) return false;
      if (
        !Array.isArray(nextConnections.connections) ||
        !Array.isArray(nextTasks.tasks) ||
        !Array.isArray(nextInput.selection)
      )
        throw new Error('Invalid feedback response');
      setConnections(nextConnections.connections);
      setRounds(nextInput.rounds ?? []);
      setTasks(nextTasks.tasks);
      setLoaded(true);
      setTarget((current) =>
        nextConnections.connections.some((connection) => connection.id === current)
          ? current
          : nextConnections.connections.length === 1
            ? nextConnections.connections[0]!.id
            : '',
      );
      if (
        pending.current &&
        nextTasks.tasks.some(
          (task) =>
            task.submissionKey === pending.current?.submissionKey &&
            task.connectionId === pending.current.connectionId,
        )
      ) {
        saveIntent(null);
        setError(null);
      }
      return true;
    } catch (failure) {
      report(failure);
      return false;
    }
  }, [api, saveIntent]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!lock.current) void refresh();
    }, 5000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    reads.current++;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      report(failure);
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  };
  const mode = !api
    ? 'legacy'
    : connections.length > 0 || tasks.some((task) => task.roundId) || intent
      ? 'connected'
      : loaded && !error
        ? 'legacy'
        : 'blocked';
  const taskFor = (roundId: string) =>
    tasks
      .filter((task) => task.roundId === roundId && task.state !== 'cancelled')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  return {
    mode,
    connections,
    target,
    setTarget,
    busy,
    error,
    intent,
    rounds,
    taskFor,
    locked: (id: string) =>
      !!taskFor(id) ||
      !!intent ||
      busy ||
      mode === 'blocked' ||
      (mode === 'connected' &&
        (rounds.find((round) => round.id === id)?.state !== 'open' || !!error)),
    refresh: () =>
      run(async () => {
        await refresh();
      }),
    changeChoice: (action: () => Promise<unknown>) =>
      run(async () => {
        await action();
        await refresh();
      }),
    submit: (roundId: string) =>
      run(async () => {
        if (!api || mode !== 'connected') return;
        const round = rounds.find((item) => item.id === roundId);
        const connection = connections.find((item) => item.id === target);
        if (
          !pending.current &&
          (!round || round.state !== 'open' || !connection?.authorized || taskFor(roundId))
        )
          return;
        const next = pending.current ?? {
          connectionId: target,
          submissionKey: nanoid(),
          round: { id: round!.id, version: round!.version },
        };
        if (next.round.id !== roundId) return;
        saveIntent(next);
        try {
          const { task } = await api.submit(next);
          setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
          saveIntent(null);
        } catch (failure) {
          if (failure instanceof FeedbackError && failure.status === 409) {
            saveIntent(null);
            await refresh();
          }
          throw failure;
        }
      }),
    cancel: (id: string) =>
      run(async () => {
        if (!api) return;
        const { task } = await api.act(id, 'cancel');
        setTasks((current) => current.map((item) => (item.id === id ? task : item)));
        await refresh();
      }),
  };
}
export type RoundFeedback = ReturnType<typeof useRoundFeedback>;
