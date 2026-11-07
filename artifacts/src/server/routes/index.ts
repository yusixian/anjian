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
import { clientSocketRoute } from './sockets';
import type { HttpRoute, UpgradeRoute } from './table';
import { libraryRoute, shellRoute, viewerFileRoute } from './viewer';

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
  boardCommentsRoute,
  documentStateRoute,
  documentWriteRoute,
  artifactApiRoute,
  libraryRoute,
  shellRoute,
  viewerFileRoute,
];

export const UPGRADE_ROUTES: UpgradeRoute<ServerContext>[] = [clientSocketRoute];
