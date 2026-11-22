import type { BoardThread } from './board-comments';
import type { Thread } from './comments';
import type { DocumentQuestion } from './document-questions';
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
  artifactAddress?: string;
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
  questionContext?: FeedbackQuestionContext;
  questionId?: string;
  questionResult?: { id: string; payloadHash: string; reply: string };
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

export const MAX_QUESTION_ANSWER_LENGTH = 4000;

export interface FeedbackQuestionContext {
  answer: string;
  definition: DocumentQuestion;
}

export interface DesignDecision {
  at: number;
  by: { id: string; login?: string };
  choice: string;
  documentId: string;
  question: DocumentQuestion;
  revision: string;
}

export interface DesignApproval {
  currentAssetsRevision?: string;
  currentRevision: string | null;
  decision?: DesignDecision;
  state: 'pending' | 'approved' | 'changes_requested' | 'needs_review';
}

export interface FeedbackQuestionInput {
  answer?: string;
  approval?: DesignApproval;
  definition: DocumentQuestion;
  id: string;
  localSubmission?: { id: string; state: 'queued' | 'delivered'; withdrawable: boolean };
  previousDefinition?: DocumentQuestion;
  task?: {
    id: string;
    state: FeedbackState;
    reply?: string;
    withdrawable: boolean;
  };
  version: string;
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
