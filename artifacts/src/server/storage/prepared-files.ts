import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

export function createPreparedStateFiles(
  trustedStateRoot: string,
  files: ReadonlyArray<{ file: string; data: string | Uint8Array }>,
) {
  const stateRoot = path.resolve(trustedStateRoot);
  const planned = [...files];
  const entries: Array<{ file: string; temp?: string; backup?: string; installed?: boolean }> = [];
  // The project path is validated by remote-transfer. Check only this subtree so
  // platform-owned aliases such as macOS /var -> /private/var remain valid.
  const checkPath = (file: string) => {
    let current = path.resolve(file);
    if (!current.startsWith(`${stateRoot}${path.sep}`)) throw new Error('State file escapes artifact state directory');
    while (current !== path.dirname(stateRoot)) {
      try {
        const stat = fsSync.lstatSync(current);
        if (stat.isSymbolicLink()) throw new Error('Unsafe artifact state path');
        if (current !== file && !stat.isDirectory()) throw new Error('Unsafe artifact state path');
        if (current === file && !stat.isFile()) throw new Error('Unsafe artifact state path');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      current = path.dirname(current);
    }
  };
  const stageFile = (file: string, data: string | Uint8Array) => {
    checkPath(file);
    fsSync.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    checkPath(file);
    const name = `${file}.${crypto.randomUUID()}.tmp`;
    fsSync.writeFileSync(name, data, { flag: 'wx', mode: 0o600 });
    entries.push({ file, temp: name });
  };
  const abort = () => {
    const errors: unknown[] = [];
    const pending: typeof entries = [];
    for (const entry of [...entries].reverse()) {
      if (entry.installed) {
        try {
          fsSync.rmSync(entry.file, { force: true });
          entry.installed = false;
        } catch (error) { errors.push(error); }
      }
      if (!entry.installed && entry.backup) {
        try {
          fsSync.renameSync(entry.backup, entry.file);
          entry.backup = undefined;
        } catch (error) { errors.push(error); }
      }
      if (entry.temp) {
        try {
          fsSync.rmSync(entry.temp, { force: true });
          entry.temp = undefined;
        } catch (error) { errors.push(error); }
      }
      if (entry.installed || entry.backup || entry.temp) pending.push(entry);
    }
    entries.splice(0, entries.length, ...pending.reverse());
    if (errors.length) throw new AggregateError(errors, 'Artifact state rollback failed');
  };
  return {
    addStateFile: (file: string, data: string | Uint8Array) => {
      if (entries.length || planned.some((entry) => entry.file === file)) throw new Error('Artifact state already staged');
      planned.push({ file, data });
    },
    stage: () => {
      try {
        for (const entry of planned) stageFile(entry.file, entry.data);
      } catch (error) {
        try { abort(); }
        catch (rollback) { throw new AggregateError([error, rollback], 'Artifact state staging cleanup failed'); }
        throw error;
      }
    },
    abort,
    commit: () => {
      if (entries.length !== planned.length) throw new Error('Artifact state was not staged');
      for (const entry of entries) {
        if (fsSync.existsSync(entry.file)) {
          const backup = `${entry.file}.${crypto.randomUUID()}.before`;
          fsSync.renameSync(entry.file, backup);
          entry.backup = backup;
        }
        if (!entry.temp) throw new Error('Artifact state staging file missing');
        fsSync.renameSync(entry.temp, entry.file);
        entry.temp = undefined;
        entry.installed = true;
      }
    },
    finalize: () => {
      for (const entry of entries) if (entry.backup) {
        try { fsSync.rmSync(entry.backup, { force: true }); }
        catch { /* Retain the previous state for recovery if cleanup fails. */ }
      }
      entries.length = 0;
    },
  };
}
