import { storyboardAnchors } from '../shared/storyboard';
import { anchoredComments } from './anchored-artifact-comments';
import { readStoryboard, StoryboardError } from './storyboard-source';

export const storyboardCommentsOf = anchoredComments({
  anchors: storyboardAnchors,
  assertAnchor(dir, { clipId }) {
    if (
      !readStoryboard(dir).storyboard.tracks.some((track) =>
        track.clips.some((c) => c.id === clipId),
      )
    )
      throw new StoryboardError(409, 'The selected clip no longer exists');
  },
  changedComments: 'Storyboard comments changed on disk. Retry this action.',
  error: StoryboardError,
  label: 'Storyboard',
  missingThread: 'Storyboard comment thread not found',
  type: 'storyboard',
});
