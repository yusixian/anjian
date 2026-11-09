const pending = new Map<string, Promise<unknown>>();

/** Remote writes and trash transitions share one project-wide serialization boundary. */
export async function withProjectMutation<T>(project: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(project) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  pending.set(project, current);
  try {
    return await current;
  } finally {
    if (pending.get(project) === current) pending.delete(project);
  }
}
