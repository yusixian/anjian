import type http from 'node:http';
import type { CommentAdmission } from '../document-comments';

const admissions = new WeakMap<http.IncomingMessage, CommentAdmission>();
const refreshers = new WeakMap<http.IncomingMessage, () => Promise<void>>();
export const requestStorageAdmission = (req: http.IncomingMessage) => admissions.get(req);
export const refreshRequestStorageAdmission = (req: http.IncomingMessage) => refreshers.get(req)?.();

/** Hub owns the quota/project locks before the mounted server tracks this request. */
export async function withRequestStorageAdmission(req: http.IncomingMessage, admit: CommentAdmission, work: () => void | Promise<void>, prepare?: () => Promise<CommentAdmission>) {
  let used = 0;
  admissions.set(req, (delta) => { const next = used + delta; admit(next); used = next; });
  if (prepare) refreshers.set(req, async () => { admit = await prepare(); used = 0; });
  try { await work(); }
  finally { admissions.delete(req); refreshers.delete(req); }
}
