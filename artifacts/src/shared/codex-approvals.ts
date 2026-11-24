export const COMMAND_APPROVAL_DECISIONS = ['accept', 'decline', 'cancel'] as const;

export type CommandApprovalDecision = (typeof COMMAND_APPROVAL_DECISIONS)[number];

export function isCommandApprovalDecision(value: unknown): value is CommandApprovalDecision {
  return value === 'accept' || value === 'decline' || value === 'cancel';
}

export type PendingCommandApproval = {
  requestId: number | string;
  threadId: string;
  command: string;
  cwd?: string;
  reason?: string;
  decisions: CommandApprovalDecision[];
};

export type PermissionOption = { kind: 'network' } | { kind: 'read' | 'write'; path: string };

export type PendingPermissionApproval = {
  requestId: number | string;
  threadId: string;
  cwd?: string;
  reason?: string;
  options: PermissionOption[];
};
