/** Pauses new project mounts while queued maintenance runs. Existing writers need a separate barrier. */
export function createProjectSuspension() {
  const gates = new Map<string, Promise<void>>();

  return {
    wait(project: string): Promise<void> | undefined { return gates.get(project); },

    async suspend<T>(project: string, before: () => Promise<void>, work: () => T | Promise<T>, after: () => void | Promise<void>): Promise<T> {
      const previous = gates.get(project);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      // Publish the new gate before awaiting the previous operation, so a mount
      // cannot slip through between two suspensions of the same project.
      gates.set(project, gate);
      try {
        if (previous) await previous;
        try {
          await before();
          return await work();
        } finally {
          await after();
        }
      } finally {
        release();
        if (gates.get(project) === gate) gates.delete(project);
      }
    },
  };
}
