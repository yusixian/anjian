/** Coalesces external notifications while an application snapshot is being taken. */
export function createDeferredInputs() {
  let paused = false;
  const pending = new Map<unknown, () => void>();
  return {
    get paused() { return paused; },
    run(key: unknown, action: () => void) {
      if (paused) pending.set(key, action);
      else action();
    },
    pause() {
      if (paused) throw new Error('Project inputs are already paused');
      paused = true;
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        paused = false;
        const actions = [...pending.values()];
        pending.clear();
        const failures: unknown[] = [];
        for (const action of actions) {
          try { action(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'Deferred project inputs failed');
      };
    },
  };
}
