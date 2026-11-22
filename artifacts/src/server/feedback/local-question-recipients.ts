import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { artifactsRootOf } from '../machine';

const HEARTBEAT_TTL = 10_000;
const PROOF = /^[a-f0-9]{64}$/;
const HOSTS = ['codex', 'pi', 'agy'] as const;
const SESSION = /^[a-z0-9][\w.-]{0,124}$/i;

function readRecipients(project: string, artifact: string, now = Date.now()) {
  const recipients: { host: (typeof HOSTS)[number]; id: string; label: string; proof: string }[] =
    [];
  for (const host of HOSTS) {
    const dir = path.join(
      artifactsRootOf(project),
      '.state',
      host + '-comment-watch',
      'questions',
      artifact,
    );
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.alive')) continue;
      const session = entry.name.slice(0, -6);
      if (!SESSION.test(session)) continue;
      let heartbeat: string;
      try {
        heartbeat = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const [time, proof] = heartbeat.trim().split(' ');
      const stamp = Number(time);
      if (
        !proof ||
        !PROOF.test(proof) ||
        !Number.isSafeInteger(stamp) ||
        stamp > now ||
        now - stamp >= HEARTBEAT_TTL
      )
        continue;
      const id = createHash('sha256')
        .update(JSON.stringify([host, session]))
        .digest('base64url');
      recipients.push({ host, id, label: session.slice(-6), proof });
    }
  }
  return recipients;
}

export function localQuestionRecipients(project: string, artifact: string) {
  return readRecipients(project, artifact).map(({ host, id, label }) => ({ host, id, label }));
}

export function localQuestionProof(project: string, artifact: string, id: string, token: string) {
  if (!PROOF.test(token)) return null;
  const proof = createHash('sha256').update(token).digest('hex');
  return readRecipients(project, artifact).some((row) => row.id === id && row.proof === proof)
    ? proof
    : null;
}
