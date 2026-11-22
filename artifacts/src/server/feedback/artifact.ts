import type { FeedbackTask } from '../../shared/feedback';
import { isFeedbackArtifactType } from '../../shared/feedback-artifact';
import { isArtifactId } from '../../shared/ids';
import { readRemoteArtifactAddress } from '../remote-transfer';
import { feedbackError } from './store';

export function feedbackArtifactParts(artifact: string) {
  const [type, id, extra] = artifact.split('/');
  return extra === undefined && isFeedbackArtifactType(type) && id && isArtifactId(id)
    ? { type, id }
    : null;
}

export function requireFeedbackArtifact(artifact: string) {
  return feedbackArtifactParts(artifact) ?? feedbackError('invalid_artifact', undefined, 400);
}

export function matchesFeedbackArtifact(
  saved: Pick<FeedbackTask, 'artifact' | 'artifactAddress'>,
  artifact: string,
  address?: string | null,
) {
  return (
    saved.artifact === artifact &&
    (saved.artifactAddress === undefined ||
      address === undefined ||
      saved.artifactAddress === address)
  );
}

export function assertFeedbackArtifactIdentity(project: string, task: FeedbackTask) {
  if (
    task.artifactAddress !== undefined &&
    readRemoteArtifactAddress(project, task.artifact) !== task.artifactAddress
  )
    feedbackError('artifact_identity_changed');
}
