import type { CommentAdmission } from '../document-comments';

type Write = (admit: CommentAdmission) => void;

/** Queue outside mounted request tracking: maintenance may already hold the quota lock. */
export function createBackgroundWrites(options: {
  execute: (work: Write) => Promise<void>;
  onError?: (error: unknown) => void;
  retryMs?: number;
}) {
  const pending = new Map<string, Write>();
  const running = new Set<string>();
  const retries = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;
  let paused = false;
  const run = async (key: string) => {
    if (closed || paused || running.has(key) || !pending.has(key)) return;
    running.add(key);
    let attempted: Write | undefined;
    let failed = false;
    try {
      await options.execute(admit => {
        if (closed || paused) return;
        attempted = pending.get(key);
        attempted?.(admit);
      });
      if (attempted && pending.get(key) === attempted) pending.delete(key);
    } catch (error) {
      failed = true;
      if (!closed) {
        try { options.onError?.(error); } catch { /* Diagnostics must not cancel retries. */ }
      }
    } finally {
      running.delete(key);
      if (!closed && !paused && pending.has(key)) {
        if (failed) {
          const timer = setTimeout(() => { retries.delete(key); void run(key); }, options.retryMs ?? 30_000);
          timer.unref?.();
          retries.set(key, timer);
        } else void run(key);
      }
    }
  };
  return {
    pause() {
      if (paused) throw new Error('Background writes already paused');
      paused = true;
      for (const timer of retries.values()) clearTimeout(timer);
      retries.clear();
      let resumed = false;
      return () => {
        if (resumed || closed) return;
        resumed = true;
        paused = false;
        for (const key of pending.keys()) void run(key);
      };
    },
    enqueue(key: string, work: Write) {
      if (closed) return;
      pending.set(key, work);
      const retry = retries.get(key);
      if (retry) { clearTimeout(retry); retries.delete(key); }
      void run(key);
    },
    close() {
      closed = true;
      pending.clear();
      for (const timer of retries.values()) clearTimeout(timer);
      retries.clear();
    },
  };
}
