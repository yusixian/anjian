import { slideAnchors } from '../../shared/slides';
import { readSlideDeck, SlideDeckError } from '../slides';
import { slidesCommentsOf } from '../slides-comments';
import { anchoredArtifactRoutes } from './anchored-artifact-comments';

export const {
  agentRoute: slidesAgentCommentRoute,
  commentState: slideCommentState,
  viewer: slidesCommentRoute,
} = anchoredArtifactRoutes({
  anchors: slideAnchors,
  commentsOf: slidesCommentsOf,
  error: SlideDeckError,
  label: 'Slide deck',
  readSource: readSlideDeck,
  type: 'slides',
});
