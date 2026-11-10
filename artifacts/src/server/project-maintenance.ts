import { withProjectMutation } from './project-mutations';

/** Caller holds the global storage queue before acquiring these project locks. */
export async function withProjectMaintenance<T>(
  projects: readonly string[],
  suspend: <R>(project: string, work: () => Promise<R>) => Promise<R>,
  work: () => Promise<T>,
  guard: () => void = () => {},
): Promise<T> {
  const ordered = [...new Set(projects)].sort();
  const pause = (index: number): Promise<T> => {
    guard();
    const project = ordered[index];
    return project === undefined ? work() : suspend(project, () => pause(index + 1));
  };
  const lock = (index: number): Promise<T> => {
    const project = ordered[index];
    return project === undefined ? pause(0) : withProjectMutation(project, () => lock(index + 1));
  };
  return lock(0);
}
