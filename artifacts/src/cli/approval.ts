import type { DocumentQuestion } from '../shared/document-questions';
import type { DesignApproval } from '../shared/feedback';
import { isArtifactAddress } from '../shared/ids';
import type { CommandSpec } from './command';
import { CliError } from './paths';
import { serverClient } from './server';

type ApprovalItem = DesignApproval & { question: DocumentQuestion };

export const approvalCommand: CommandSpec = {
  name: 'approval',
  summary: 'Read human decisions and check if a document revision is approved for implementation',
  usage: ['--artifact document/<stable-id> [--require <question-id>] [--json]'],
  options: {
    artifact: {
      type: 'string',
      value: 'document/<stable-id>',
      help: 'Stable address of the design document',
    },
    require: {
      type: 'string',
      value: '<question-id>',
      help: 'Exit nonzero unless this question approves the current revision',
    },
  },
  async run({ values, projectDir }, emit) {
    const artifact = values.artifact;
    if (
      typeof artifact !== 'string' ||
      !artifact.startsWith('document/') ||
      !isArtifactAddress(artifact.slice('document/'.length))
    )
      throw new CliError('--artifact must be document/<stable-id>');
    const { status, json } = await serverClient(projectDir).call(
      'GET',
      `/api/${artifact}/feedback/approvals`,
    );
    if (status < 200 || status >= 300 || !Array.isArray(json.items))
      throw new CliError(
        typeof json.error === 'string'
          ? json.error
          : `Could not read document approvals (HTTP ${status}).`,
      );
    emit({ type: 'document-approvals', ...json });
    if (
      typeof values.require === 'string' &&
      !(json.items as ApprovalItem[]).some(
        (item) => item.question.id === values.require && item.state === 'approved',
      )
    )
      return 1;
    return 0;
  },
  text(value) {
    if (value.type !== 'document-approvals') return null;
    const lines = [
      `Document ${value.documentId}`,
      `Current revision ${value.currentRevision ?? 'unavailable'}`,
    ];
    for (const { state, question, decision } of value.items as ApprovalItem[]) {
      lines.push(`${question.id}  ${state}`);
      if (decision)
        lines.push(
          `  ${decision.choice} by ${decision.by.login ?? decision.by.id} on ${new Date(decision.at).toISOString()}`,
          `  Decided revision ${decision.revision}`,
        );
    }
    return lines.join('\n');
  },
};
