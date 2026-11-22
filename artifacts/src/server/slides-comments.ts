import { slideAnchors } from '../shared/slides';
import {
  anchoredComments,
  asAnchoredAgentOp,
  asAnchoredHumanOp,
} from './anchored-artifact-comments';
import { readSlideDeck, SlideDeckError } from './slides';

export const asSlideHumanOp = (value: unknown) => asAnchoredHumanOp(value, slideAnchors);
export const asSlideAgentOp = (value: unknown) => asAnchoredAgentOp(value, slideAnchors);

export const slidesCommentsOf = anchoredComments({
  anchors: slideAnchors,
  assertAnchor(dir, { slideId }) {
    if (!readSlideDeck(dir).deck.slides.some((slide) => slide.id === slideId))
      throw new SlideDeckError(409, 'The selected slide no longer exists');
  },
  changedComments: 'Slide comments changed on disk. Retry this action.',
  error: SlideDeckError,
  label: 'Slide deck',
  missingThread: 'Slide comment thread not found',
  type: 'slides',
});
