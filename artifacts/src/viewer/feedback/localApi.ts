import { isFeedbackArtifactType } from '../../shared/feedback-artifact';
import { isArtifactAddress } from '../../shared/ids';
import { createFeedbackApi } from './api';

/** Only the local application owns the server route convention. */
export function feedbackApi(artifact: string) {
  const [type, id, ...extra] = artifact.split('/');
  if (
    !type ||
    !isFeedbackArtifactType(type) ||
    !id ||
    (!isArtifactAddress(id) && !/^[a-z0-9][\w-]*$/i.test(id)) ||
    extra.length
  )
    throw new Error('Invalid artifact');
  return createFeedbackApi(`/api/${artifact}/feedback`);
}
