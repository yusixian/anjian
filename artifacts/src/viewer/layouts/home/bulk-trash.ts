import type { HubArtifact } from '../../../shared/hub';
import { artifactSelectionKey } from '../../../shared/trash';

export const MAX_TRASH_BATCH = 100;

export function selectionForVisible(
  current: Set<string>,
  visible: HubArtifact[],
  select: boolean,
) {
  const next = new Set(current);
  for (const artifact of visible) {
    const key = artifactSelectionKey(artifact);
    if (select) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function rangeForVisible(
  current: Set<string>,
  visible: HubArtifact[],
  anchor: string | null,
  target: string,
) {
  const end = visible.findIndex((item) => artifactSelectionKey(item) === target);
  const start = visible.findIndex((item) => artifactSelectionKey(item) === anchor);
  if (end < 0 || start < 0) return new Set(current).add(target);
  const next = new Set(current);
  for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
    next.add(artifactSelectionKey(visible[index]!));
  }
  return next;
}

export function chunks<T>(items: T[], size = MAX_TRASH_BATCH): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}
