import fs from 'node:fs';
import path from 'node:path';

import { FEEDBACK_ARTIFACT_TYPES } from '../shared/feedback-artifact';

const HOSTS = ['claude', 'codex', 'pi', 'agy'];
const COMMENT_ARTIFACT = new RegExp(
  `^(?:${FEEDBACK_ARTIFACT_TYPES.join('|')})/[a-z0-9][a-z0-9-]*$`,
);
const FRESH_MS = 10_000;

function readSubscription(file: string): string[] {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { artifacts?: unknown };
    return Array.isArray(value.artifacts)
      ? value.artifacts.filter((a): a is string => typeof a === 'string')
      : [];
  } catch {
    return [];
  }
}

function beatAt(file: string): number | null {
  try {
    const stamp = Number(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

function hasOpenedBeat(dir: string, artifact: string, now: number): boolean {
  if (!COMMENT_ARTIFACT.test(artifact)) return false;
  const opened = path.join(dir, 'opened', artifact);
  try {
    return fs.readdirSync(opened).some((name) => {
      if (!name.endsWith('.alive')) return false;
      const stamp = beatAt(path.join(opened, name));
      return stamp !== null && now - stamp < FRESH_MS;
    });
  } catch {
    return false;
  }
}

export function listeningOn(stateDir: string, artifact: string, now = Date.now()): boolean {
  for (const host of HOSTS) {
    const dir = path.join(stateDir, `${host}-comment-watch`);
    if (hasOpenedBeat(dir, artifact, now)) return true;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const artifacts = readSubscription(path.join(dir, name));
      if (!artifacts.includes('*') && !artifacts.includes(artifact)) continue;
      const beat = beatAt(path.join(dir, name.replace(/\.json$/, '.alive')));
      if (beat !== null && now - beat < FRESH_MS) return true;
    }
  }
  return false;
}
