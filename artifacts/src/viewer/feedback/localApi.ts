import { createFeedbackApi } from './api';

/** Only the local application owns the server route convention. */
export function feedbackApi(artifact: string) {
  if (!/^(?:document|artboard)\/[A-Za-z0-9][\w-]*$/.test(artifact))
    throw new Error('Invalid artifact');
  return createFeedbackApi(`/api/${artifact}/feedback`);
}
