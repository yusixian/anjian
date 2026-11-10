import type http from 'node:http';
import type { CommentAdmission } from '../document-comments';

const admissions = new WeakMap<http.IncomingMessage, CommentAdmission>();
export const requestStorageAdmission = (req: http.IncomingMessage) => admissions.get(req);

/** Hub owns the quota/project locks before the mounted server tracks this request. */
export async function withRequestStorageAdmission(req: http.IncomingMessage, admit: CommentAdmission, work: () => void | Promise<void>) {
  let used = 0;
  admissions.set(req, (delta) => { const next = used + delta; admit(next); used = next; });
  try { await work(); }
  finally { admissions.delete(req); }
}
