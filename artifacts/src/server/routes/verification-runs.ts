import fs from 'node:fs';
import path from 'node:path';

import { resolveArtifactAddress } from '../artifact-address';
import { isArtifactAddress, isArtifactLocator } from '../artifacts';
import type { ServerContext } from '../context';
import { sendJson } from '../http';
import type { HttpRoute } from './table';

export const verificationRunsRoute: HttpRoute<ServerContext> = {
  path: /^\/api\/document\/([^/]+)\/verification(?:\/([a-z0-9][a-z0-9-]{0,63})|\/runs\/([^/]+))?$/,
  methods: ['GET', 'POST'],
  auth: 'viewer',
  handle(req, res, ctx, { match }) {
    res.setHeader('Cache-Control', 'no-store');
    const service = ctx.mount?.verificationRuns;
    const locator = match[1]!;
    const check = match[2];
    if (req.method === 'POST' && (!check || !ctx.sameOrigin(req))) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }
    if (!ctx.mount?.verificationAccess?.(req) || !service?.enabled() || !isArtifactLocator(locator))
      return sendJson(res, 404, {});
    try {
      const artifact = resolveArtifactAddress(ctx.root, 'document', locator, {
        mintMissing: false,
      });
      if (!artifact || !fs.existsSync(path.join(artifact.dir, 'doc.xml')))
        return sendJson(res, 404, {});
      const address = fs.readFileSync(path.join(artifact.dir, '.artifact-id'), 'utf8').trim();
      if (!isArtifactAddress(address)) return sendJson(res, 404, {});
      const project = path.resolve(ctx.root, '../..');
      if (req.method === 'GET') {
        if (match[3]) {
          const run = service.run(project, address, match[3]);
          return run ? sendJson(res, 200, run) : sendJson(res, 404, {});
        }
        if (check) return sendJson(res, 404, {});
        const snapshot = service.snapshot(project, address);
        return snapshot ? sendJson(res, 200, snapshot) : sendJson(res, 404, {});
      }
      const result = service.start(project, address, check!);
      if (result === 'accepted') return sendJson(res, 202, {});
      if (result === 'running') return sendJson(res, 409, { error: 'A check is already running' });
      return sendJson(res, 404, {});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sendJson(res, 404, {});
      console.error('Could not access verification runs', error);
      return sendJson(res, 500, { error: 'Verification checks could not be loaded' });
    }
  },
};
