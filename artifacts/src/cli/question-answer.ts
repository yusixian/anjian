import { createHash } from 'node:crypto';

import { assertArtifactNotTrashed } from '../server/artifact-trash';
import { feedbackStore } from '../server/feedback/store';
import { machinePaths, readProjects } from '../server/machine';
import { readRemoteArtifactAddress, readRemoteArtifactRevision } from '../server/remote-transfer';
import { isArtifactId } from '../shared/ids';
import type { CommandSpec } from './command';
import { CliError, projectPaths } from './paths';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREFIX = 'document/';

export const questionAnswerCommand: CommandSpec = {
  name: 'question-answer',
  summary: 'Read one local document answer from its delivery reference',
  usage: ['--artifact document/<id> --submission <id> --recipient <id> [--json]'],
  options: {
    artifact: { type: 'string', value: 'document/<id>', help: 'Local document directory ID' },
    recipient: { type: 'string', value: '<id>', help: 'Recipient ID from the delivery message' },
    submission: { type: 'string', value: '<id>', help: 'Submission ID from the delivery message' },
  },
  run({ projectDir, values }, emit) {
    const { artifact, recipient, submission } = values;
    if (
      typeof artifact !== 'string' ||
      !artifact.startsWith(PREFIX) ||
      !isArtifactId(artifact.slice(PREFIX.length))
    )
      throw new CliError('--artifact must be document/<id>');
    if (typeof submission !== 'string' || !UUID.test(submission))
      throw new CliError('--submission must be a delivery ID');
    if (typeof recipient !== 'string' || !/^[\w-]{43}$/.test(recipient))
      throw new CliError('--recipient must be the ID from the delivery message');
    const { project } = projectPaths(projectDir);
    const machine = machinePaths();
    if (!readProjects(machine.projects).some(({ dir }) => project === dir))
      throw new CliError('This worktree is not registered with the local Anjian Hub.');
    const projectId = createHash('sha256').update(project).digest('hex').slice(0, 32);
    const data = feedbackStore(machine.home, projectId).load();
    const row = data.localQuestions?.find(
      ({ artifact: source, id, recipient: destination, state }) =>
        source === artifact &&
        id === submission &&
        destination === recipient &&
        state !== 'cancelled',
    );
    if (!row) throw new CliError('No matching local answer in this worktree.');
    assertArtifactNotTrashed(project, 'document', artifact.slice(PREFIX.length));
    if (
      readRemoteArtifactAddress(project, artifact) !== row.artifactAddress ||
      readRemoteArtifactRevision(project, artifact)?.revision !== row.revision
    )
      throw new CliError('The document changed after submission. Ask the reader to submit again.');
    emit({
      type: 'local-document-question-answer',
      artifact,
      id: row.id,
      revision: row.revision,
      ...row.input,
    });
    return 0;
  },
};
