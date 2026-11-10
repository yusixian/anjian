import fs from 'node:fs';
import type { CommentAdmission } from '../document-comments';
import { createPreparedStateFiles } from './prepared-files';

/** Commit related JSON files together after admitting their combined size change. */
export function writeJsonFiles(root: string, files: Array<{ file: string; value: unknown }>, admit?: CommentAdmission) {
  const planned = files.map(({ file, value }) => ({ file, data: `${JSON.stringify(value, null, 2)}\n` }));
  let delta = 0;
  for (const { file, data } of planned) {
    let before = 0;
    try { before = fs.statSync(file).size; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    delta += Buffer.byteLength(data) - before;
  }
  admit?.(delta);
  const transaction = createPreparedStateFiles(root, planned);
  transaction.stage();
  try { transaction.commit(); }
  catch (error) {
    try { transaction.abort(); }
    catch (rollback) { throw new AggregateError([error, rollback], 'JSON files rollback failed'); }
    throw error;
  }
  transaction.finalize();
}
