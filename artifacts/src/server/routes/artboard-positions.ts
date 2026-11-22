import { artboardPosition } from '../../shared/artboard-positions';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import { resolveArtifactAddress } from '../artifact-address';
import { artboardPositionsFile, parseArtboardMove, readArtboardPositions } from '../artboard-positions';
import type { ServerContext } from '../context';
import { sendJson } from '../http';
import { readCanvas } from '../state';
import { writeJsonFiles } from '../storage/json-files';
import {
  refreshRequestStorageAdmission,
  requestStorageAdmission,
} from '../storage/request-admission';
import { readCommentBody } from './comments';
import type { HttpRoute } from './table';

export const artboardPositionsRoute: HttpRoute<ServerContext> = {
  path: new RegExp(`^/api/artboard/(${ARTIFACT_LOCATOR_SOURCE})/positions$`),
  methods: ['POST'],
  auth: 'same-origin',
  async handle(req, res, ctx, { key, match }) {
    res.setHeader('Cache-Control', 'no-store');
    const move = parseArtboardMove(await readCommentBody(req));
    if (!move) return sendJson(res, 400, { code: 'invalid_position' });
    await refreshRequestStorageAdmission(req);
    if (!ctx.isAuthorized(req, key)) return sendJson(res, 403, { code: 'forbidden' });
    const entry = resolveArtifactAddress(ctx.root, 'artboard', match[1]!, { mintMissing: false });
    if (!entry) return sendJson(res, 404, { code: 'artboard_not_found' });
    const { dir, id } = entry;
    const file = artboardPositionsFile(dir);
    const { canvas } = readCanvas(dir, id, file);
    const current = canvas && artboardPosition(canvas, move.target);
    const { expected, target, x, y } = move;
    if (!current || current.page !== expected.page)
      return sendJson(res, 409, { code: 'position_changed' });
    const position = { page: current.page, x, y };
    if (current.x === x && current.y === y) return sendJson(res, 200, { position });
    if (current.x !== expected.x || current.y !== expected.y)
      return sendJson(res, 409, { code: 'position_changed' });
    const positions = { ...readArtboardPositions(file), [`${target.kind}/${target.id}`]: position };
    writeJsonFiles(ctx.stateDir, [{ file, value: positions }], requestStorageAdmission(req));
    const ref = { type: 'artboard' as const, id };
    const payload = ctx.refreshState(ref, dir);
    ctx.broadcast({ type: 'change', artifact: `artboard/${id}`, files: [] });
    ctx.changeListeners.forEach((listener) => listener(ref, payload, []));
    return sendJson(res, 200, { position });
  },
};
