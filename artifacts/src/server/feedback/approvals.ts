import { type DocumentQuestion, sameDocumentQuestion } from '../../shared/document-questions';
import type { DesignApproval, DesignDecision } from '../../shared/feedback';
import type { FeedbackData } from './store';

function latestDecision(data: FeedbackData, documentId: string, questionId: string) {
  const { decisions } = data;
  if (!decisions) return;
  for (let index = decisions.length - 1; index >= 0; index--) {
    const decision = decisions[index]!;
    if (decision.documentId === documentId && decision.question.id === questionId) return decision;
  }
}

export function approvalFor(
  data: FeedbackData,
  documentId: string,
  liveQuestion: DocumentQuestion,
  currentRevision: string | null,
): DesignApproval {
  const decision = latestDecision(data, documentId, liveQuestion.id);
  if (!decision) return { currentRevision, state: 'pending' };
  if (
    decision.revision !== currentRevision ||
    !sameDocumentQuestion(decision.question, liveQuestion)
  )
    return { currentRevision, decision, state: 'needs_review' };
  return {
    currentRevision,
    decision,
    state: decision.choice === liveQuestion.approve ? 'approved' : 'changes_requested',
  };
}

export function recordDesignDecision(data: FeedbackData, decision: DesignDecision): boolean {
  const latest = latestDecision(data, decision.documentId, decision.question.id);
  if (
    latest?.revision === decision.revision &&
    latest.choice === decision.choice &&
    latest.by.id === decision.by.id &&
    sameDocumentQuestion(latest.question, decision.question)
  )
    return false;
  (data.decisions ??= []).push(decision);
  return true;
}
