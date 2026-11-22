import type { Sources } from './comment-watch.cjs';

export function createLocalCommentEvents(
  wake: () => void,
  env?: NodeJS.ProcessEnv,
  entry?: string,
): { scope(sources: Sources): Sources; close(): void };
