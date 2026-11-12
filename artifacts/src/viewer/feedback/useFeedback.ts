import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type FeedbackConnection,
  FeedbackError,
  type FeedbackInput,
  type FeedbackTask,
  readIntent,
  selectableInput,
  storeIntent,
  type SubmissionIntent,
} from './api';
import { useFeedbackApi } from './FeedbackProvider';

export function useFeedback(artifact: string) {
  const api = useFeedbackApi(artifact);
  const [connections, setConnections] = useState<FeedbackConnection[]>([]);
  const [tasks, setTasks] = useState<FeedbackTask[]>([]);
  const [input, setInput] = useState<FeedbackInput | null>(null);
  const [intent, setIntent] = useState(() => readIntent(artifact));
  const pending = useRef(intent);
  const submittedTask = useRef<string | null>(null);
  const [selected, setSelected] = useState<string[]>(
    () => intent?.selection.map((s) => s.threadId) ?? [],
  );
  const [target, setTarget] = useState(intent?.connectionId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const saveIntent = useCallback(
    (next: SubmissionIntent | null) => {
      const stored = storeIntent(artifact, next);
      if (next && !stored) throw new FeedbackError(0, 'storage_unavailable');
      pending.current = next;
      setIntent(next);
    },
    [artifact],
  );
  const report = (failure: unknown) => {
    if (!alive.current) return;
    setError(
      failure instanceof FeedbackError
        ? failure.status === 401 ||
          failure.status === 403 ||
          failure.code === 'connection_unauthorized'
          ? 'authorization'
          : failure.code === 'storage_unavailable'
            ? 'storage'
            : failure.code === 'feedback_changed'
              ? 'changed'
              : failure.status === 409
                ? 'conflict'
                : 'failed'
        : 'network',
    );
  };
  const refresh = useCallback(async () => {
    try {
      const [nextConnections, nextTasks, nextInput] = await Promise.all([
        api.connections(),
        api.tasks(),
        api.input(),
      ]);
      if (!alive.current) return;
      if (
        !Array.isArray(nextConnections.connections) ||
        !Array.isArray(nextTasks.tasks) ||
        !Array.isArray(nextInput.threads) ||
        !Array.isArray(nextInput.selection)
      )
        throw new Error('Invalid feedback response');
      setConnections(nextConnections.connections);
      setTasks(nextTasks.tasks);
      if (
        nextTasks.tasks.some((task) => task.id === submittedTask.current && task.state !== 'queued')
      ) {
        setNotice((current) => (current === 'submitted' ? null : current));
      }
      setInput(nextInput);
      setLoaded(true);
      if (
        pending.current &&
        nextTasks.tasks.some(
          (task) =>
            task.submissionKey === pending.current?.submissionKey &&
            task.connectionId === pending.current.connectionId,
        )
      ) {
        saveIntent(null);
        setSelected([]);
        setError(null);
      }
    } catch (failure) {
      report(failure);
    }
  }, [api, saveIntent]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!lock.current) void refresh();
    }, 5000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      report(failure);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submit = () =>
    run(async () => {
      const next =
        pending.current ??
        (input && target
          ? {
              connectionId: target,
              submissionKey: nanoid(),
              selection: selectableInput(input).filter((s) => selected.includes(s.threadId)),
            }
          : null);
      if (!next?.selection.length) return;
      saveIntent(next);
      try {
        const { task } = await api.submit(next);
        setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
        saveIntent(null);
        setSelected([]);
        submittedTask.current = task.id;
        setNotice('submitted');
      } catch (failure) {
        // A definite conflict requires fresh user confirmation. Unknown responses retain the exact intent.
        if (failure instanceof FeedbackError && failure.status === 409) {
          saveIntent(null);
          await refresh();
        }
        throw failure;
      }
    });
  return {
    connections,
    tasks,
    input,
    selected,
    target,
    intent,
    error,
    notice,
    busy,
    loaded,
    setTarget,
    setSelected,
    submit,
    refresh: () =>
      run(async () => {
        await refresh();
      }),
    act: (id: string, action: 'accept' | 'retry' | 'cancel') =>
      run(async () => {
        const { task } = await api.act(id, action);
        setTasks((current) => current.map((item) => (item.id === id ? task : item)));
        if (action === 'retry') setNotice('retryRequested');
        await refresh();
      }),
    pause: (id: string, paused: boolean) =>
      run(async () => {
        await api.pause(id, paused);
        await refresh();
      }),
  };
}
