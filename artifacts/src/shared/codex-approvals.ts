export const COMMAND_APPROVAL_DECISIONS = ['accept', 'decline', 'cancel'] as const;

export type CommandApprovalDecision = (typeof COMMAND_APPROVAL_DECISIONS)[number];

export function isCommandApprovalDecision(value: unknown): value is CommandApprovalDecision {
  return COMMAND_APPROVAL_DECISIONS.includes(value);
}

export type PendingCommandApproval = {
  requestId: number | string;
  threadId: string;
  command: string;
  cwd?: string;
  reason?: string;
  decisions: CommandApprovalDecision[];
};
