import type { BuildInfo } from './build-info';
import type { ArtifactSummary } from './types';

export interface HubArtifact extends ArtifactSummary {
  project: string;
  url: string;
}

export interface HubArtifactList {
  artifacts: HubArtifact[];
  projects: HubProjectStatus[];
  warnings: string[];
}

export interface HubProjectStatus {
  artifacts: number;
  dir: string;
  dormant: boolean;
  lastUsedAt: number;
  name: string;
}

export interface HubStatus {
  authenticationRequired?: boolean;
  boardPort: number;
  build?: BuildInfo;
  clients: number;
  deployment?: 'local' | 'self-hosted';
  lastActivity: number;
  live: { local: number };
  pid: number;
  port: number;
  projects: HubProjectStatus[];
  startedAt: number;
  url: string;
  version: string;
}
