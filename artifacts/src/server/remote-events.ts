import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface RemoteEvent {
  id: string;
  artifact: string;
  type: string;
  data: unknown;
}
interface Journal {
  epoch: string;
  sequence: number;
  events: RemoteEvent[];
}
const MAX_EVENTS = 1000;
const MAX_BYTES = 16 * 1024 * 1024;

export class RemoteCursorError extends Error {}

export function createRemoteEvents(home: string) {
  const directory = path.join(home, 'remote-events');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Event directory must not be a symlink');
  fs.chmodSync(directory, 0o700);
  const journals = new Map<string, Journal>();
  const failed = new Set<string>();
  const fileOf = (project: string) => {
    if (!/^[a-f0-9]{32}$/.test(project)) throw new Error('Invalid project id');
    return path.join(directory, `${project}.json`);
  };
  function save(project: string, journal: Journal) {
    const file = fileOf(project);
    const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(journal));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
  }
  function read(project: string): Journal {
    const cached = journals.get(project);
    if (cached) return cached;
    const file = fileOf(project);
    let journal: Journal;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid event journal');
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Journal;
      if (!/^[a-f0-9]{24}$/.test(value.epoch) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.events))
        throw new Error('Invalid event journal');
      journal = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      journal = { epoch: crypto.randomBytes(12).toString('hex'), sequence: 0, events: [] };
      save(project, journal);
    }
    journals.set(project, journal);
    return journal;
  }
  const cursor = (journal: Journal) => `${journal.epoch}:${journal.sequence}`;
  return {
    append(project: string, artifact: string, type: string, data: unknown) {
      const prior = read(project);
      const next = failed.has(project)
        ? { epoch: crypto.randomBytes(12).toString('hex'), sequence: 1, events: [] as RemoteEvent[] }
        : { ...prior, sequence: prior.sequence + 1, events: [...prior.events] };
      const event: RemoteEvent = { id: cursor(next), artifact, type, data };
      if (Buffer.byteLength(JSON.stringify(event)) > MAX_BYTES / 2)
        throw new Error('Feedback event exceeds journal limit');
      next.events.push(event);
      while (next.events.length > MAX_EVENTS || Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES)
        next.events.shift();
      try { save(project, next); } catch (error) { failed.add(project); throw error; }
      journals.set(project, next);
      failed.delete(project);
    },
    since(project: string, after: string | null) {
      if (failed.has(project)) throw new Error('Event journal unavailable');
      const journal = read(project);
      if (after === null) return { cursor: cursor(journal), events: [] };
      const [epoch, raw, extra] = after.split(':');
      const sequence = Number(raw);
      const first = journal.events[0] ? Number(journal.events[0].id.split(':')[1]) : journal.sequence + 1;
      if (extra !== undefined || epoch !== journal.epoch || !/^\d+$/.test(raw ?? '') ||
          !Number.isSafeInteger(sequence) || sequence > journal.sequence || sequence < first - 1)
        throw new RemoteCursorError('反馈游标已失效，请读取当前批注后使用 watch --reset 重新建立监听。');
      return { cursor: cursor(journal), events: journal.events.filter((event) => Number(event.id.split(':')[1]) > sequence) };
    },
  };
}
