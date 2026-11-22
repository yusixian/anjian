import { storyboardAnchors } from '../../shared/storyboard';
import { storyboardCommentsOf } from '../storyboard-comments';
import { readStoryboard, StoryboardError } from '../storyboard-source';
import { anchoredArtifactRoutes } from './anchored-artifact-comments';

export const {
  agentRoute: storyboardAgentCommentRoute,
  commentState: storyboardCommentState,
  viewer: storyboardCommentRoute,
} = anchoredArtifactRoutes({
  anchors: storyboardAnchors,
  commentsOf: storyboardCommentsOf,
  error: StoryboardError,
  label: 'Storyboard',
  readSource: readStoryboard,
  type: 'storyboard',
});
