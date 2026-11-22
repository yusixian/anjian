import type { ServerContext } from '../context';
import { agentBoardCommentsRoute, agentCheckRoute, agentCommentsRoute } from './agent';
import {
  artifactApiRoute,
  avatarRoute,
  listRoute,
  previewApiRoute,
  thumbnailRoute,
} from './artifacts';
import { boardCommentsRoute } from './comments';
import { contentRoute, robotsRoute, statusRoute } from './content';
import { documentStateRoute, documentWriteRoute } from './documents';
import { reviewEvidenceRoute } from './review-evidence';
import { selectionSendRoute } from './selection-send';
import { slideDeckRoute } from './slides';
import { slidesAgentCommentRoute, slidesCommentRoute } from './slides-comments';
import { clientSocketRoute } from './sockets';
import { storyboardAssetsRoute, storyboardJobRoute, storyboardRenderRoute, storyboardRoute, storyboardVideoRoute } from './storyboard';
import { storyboardAgentCommentRoute, storyboardCommentRoute } from './storyboard-comments';
import type { HttpRoute, UpgradeRoute } from './table';
import { libraryRoute, shellRoute, viewerFileRoute } from './viewer';
import {
  whiteboardAgentCommentRoute,
  whiteboardCommentRoute,
  whiteboardPagesRoute,
  whiteboardSceneRoute,
} from './whiteboard';

// Order matters: earlier routes shadow later ones.
export const HTTP_ROUTES: HttpRoute<ServerContext>[] = [
  statusRoute,
  robotsRoute,
  contentRoute,
  listRoute,
  avatarRoute,
  previewApiRoute,
  thumbnailRoute,
  agentCommentsRoute,
  agentBoardCommentsRoute,
  agentCheckRoute,
  reviewEvidenceRoute,
  boardCommentsRoute,
  selectionSendRoute,
  storyboardAssetsRoute,
  storyboardRenderRoute,
  storyboardJobRoute,
  storyboardVideoRoute,
  storyboardCommentRoute,
  storyboardAgentCommentRoute,
  storyboardRoute,
  slideDeckRoute,
  slidesCommentRoute,
  slidesAgentCommentRoute,
  documentStateRoute,
  documentWriteRoute,
  whiteboardSceneRoute,
  whiteboardPagesRoute,
  whiteboardCommentRoute,
  whiteboardAgentCommentRoute,
  artifactApiRoute,
  libraryRoute,
  shellRoute,
  viewerFileRoute,
];

export const UPGRADE_ROUTES: UpgradeRoute<ServerContext>[] = [clientSocketRoute];
