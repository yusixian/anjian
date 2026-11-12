import type { BoardThread } from './board-comments';
import type { Thread } from './comments';
import type { CanvasSpec } from './types';

export type FeedbackState =
  'queued' | 'running' | 'needs_attention' | 'awaiting_review' | 'accepted' | 'cancelled';
export interface FeedbackConnection {
  artifacts: string[];
  confirmedAt: number;
  deviceId: string;
  displayName: string;
  enabled: boolean;
  generation: number;
  host: 'lody';
  id: string;
  project: string;
  rebindRequests?: Array<{ requestId: string; payloadHash: string; generation: number }>;
  requestId: string;
  session: string;
}
export interface FeedbackClaim {
  attempt: number;
  connectionId: string;
  generation: number;
  token: string;
}
export interface FeedbackOperation {
  baseRevision: string;
  expectedRevision: string;
  id: string;
  payloadHash: string;
  replies: Array<{ threadId: string; messageId: string; text: string }>;
  stage: 'prepared' | 'uploaded' | 'replied' | 'complete';
}
export interface FeedbackTask {
  artifact: string;
  attempt: number;
  claimOwner?: string;
  claimRecoverySeq?: number;
  claimRequestId?: string;
  claimRequests: string[];
  connectionId: string;
  createdAt: number;
  errorCode?: string;
  generation: number;
  id: string;
  inputRevision: string;
  leaseUntil?: number;
  operation?: FeedbackOperation;
  outputRevision?: string;
  recoveryConsumedSeq?: number;
  recoveryRequestSeq?: number;
  roundContext?: FeedbackRoundContext;
  roundId?: string;
  state: FeedbackState;
  submissionHash: string;
  submissionKey: string;
  threads: Thread<unknown>[];
  tokenHash?: string;
  updatedAt: number;
}

export interface FeedbackRoundGroup {
  at?: string;
  boards: string[];
  by?: 'human' | 'agent';
  byRecommendation: boolean;
  choice: string | null;
  id: string;
  recommend?: string;
  threadIds: string[];
  title?: string;
}
export interface FeedbackRoundInput {
  groups: FeedbackRoundGroup[];
  id: string;
  page: string;
  state: 'open' | 'submitted' | 'closed';
  threadCount: number;
  title?: string;
  version: string;
}
export interface FeedbackRoundContext extends Omit<FeedbackRoundInput, 'version' | 'threadCount'> {
  canvas: CanvasSpec;
  choiceRecords: BoardThread[];
  threads: BoardThread[];
}
