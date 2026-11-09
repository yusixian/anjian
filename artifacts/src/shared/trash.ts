import type { HubArtifact } from './hub';

export interface TrashEntry extends HubArtifact {
  trashId: string;
  deletedAt: number;
  expiresAt: number;
}

export interface TrashTarget {
  project: string;
  type: HubArtifact['type'];
  id: string;
  url: string;
}

export interface TrashReference {
  project: string;
  trashId: string;
}

export interface TrashResult {
  key: string;
  ok: boolean;
  entry?: TrashEntry;
  code?: string;
  error?: string;
}

export const artifactSelectionKey = (item: Pick<HubArtifact, 'project' | 'url'>) =>
  `${item.project}\n${item.url}`;

export const trashSelectionKey = (item: TrashReference) => `${item.project}\n${item.trashId}`;
