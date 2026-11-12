/** Browser-only feedback DTOs. Execution credentials never belong in this adapter. */
export interface FeedbackConnection {
  artifacts: string[];
  authorized: boolean;
  displayName: string;
  enabled: boolean;
  id: string;
}
export interface FeedbackSelection {
  messageIds: string[];
  threadId: string;
  version: string;
}
export interface FeedbackThread {
  anchor?: { choice?: unknown; round?: unknown };
  id: string;
  messages: { id: string; text: string; deleted?: boolean }[];
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
export interface RoundSubmissionIntent {
  connectionId: string;
  round: { id: string; version: string };
  submissionKey: string;
}
export interface FeedbackInput {
  artifact: string;
  revision: string;
  rounds?: FeedbackRoundInput[];
  selection: FeedbackSelection[];
  threads: FeedbackThread[];
}
export type FeedbackState =
  'queued' | 'running' | 'needs_attention' | 'awaiting_review' | 'accepted' | 'cancelled';
export interface FeedbackTask {
  attempt: number;
  connectionId: string;
  createdAt: number;
  errorCode?: string;
  id: string;
  inputRevision: string;
  needsRecovery: boolean;
  operation?: {
    stage: string;
    replies?: { threadId: string; messageId: string; text: string }[];
  };
  outputRevision?: string;
  roundContext?: {
    id: string;
    title?: string;
    groups: FeedbackRoundGroup[];
    canvas?: { boards: Record<string, { title?: string }> };
  };
  roundId?: string;
  state: FeedbackState;
  submissionKey: string;
  threads?: FeedbackThread[];
}
export interface SubmissionIntent {
  connectionId: string;
  selection: FeedbackSelection[];
  submissionKey: string;
}
export class FeedbackError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function createFeedbackApi(base: string) {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(
      `${base}/${path}`,
      body === undefined
        ? { cache: 'no-store', credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const data = await response.json();
    if (!response.ok) throw new FeedbackError(response.status, data.code ?? 'feedback_failed');
    return data as T;
  }
  return {
    connections: () => request<{ connections: FeedbackConnection[] }>('connections'),
    input: () => request<FeedbackInput>('input'),
    tasks: () => request<{ tasks: FeedbackTask[] }>('tasks'),
    task: (id: string) => request<{ task: FeedbackTask }>(`tasks/${encodeURIComponent(id)}`),
    submit: (intent: SubmissionIntent | RoundSubmissionIntent) =>
      request<{ task: FeedbackTask }>('submit', intent),
    act: (id: string, action: 'accept' | 'retry' | 'cancel') =>
      request<{ task: FeedbackTask }>(`tasks/${encodeURIComponent(id)}/${action}`, {}),
    pause: (id: string, paused: boolean) =>
      request<{ connection: FeedbackConnection }>(
        `connections/${encodeURIComponent(id)}/${paused ? 'pause' : 'resume'}`,
        {},
      ),
  };
}

// Store only the non-secret input boundary, never comment text or credentials.
export function readIntent(artifact: string): SubmissionIntent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`anjian.feedback.${artifact}`) ?? 'null');
    return value &&
      typeof value.connectionId === 'string' &&
      typeof value.submissionKey === 'string' &&
      Array.isArray(value.selection) &&
      value.selection.every(
        (s: FeedbackSelection) =>
          s &&
          typeof s.threadId === 'string' &&
          typeof s.version === 'string' &&
          Array.isArray(s.messageIds) &&
          s.messageIds.every((id) => typeof id === 'string'),
      )
      ? value
      : null;
  } catch {
    return null;
  }
}
export function storeIntent(artifact: string, intent: SubmissionIntent | null) {
  try {
    if (intent) sessionStorage.setItem(`anjian.feedback.${artifact}`, JSON.stringify(intent));
    else sessionStorage.removeItem(`anjian.feedback.${artifact}`);
    return true;
  } catch {
    return false;
  }
}
export function selectableInput(input: FeedbackInput) {
  const ids = new Set(
    input.threads
      .filter(
        (thread) =>
          thread.messages.some((message) => !message.deleted) &&
          !('choice' in (thread.anchor ?? {})) &&
          !('round' in (thread.anchor ?? {})),
      )
      .map((thread) => thread.id),
  );
  return input.selection.filter((selection) => ids.has(selection.threadId));
}
