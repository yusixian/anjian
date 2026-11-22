import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { Person } from '../shared/comments';
import { detectAgent } from './agent';
import type { ArtifactRef } from './artifacts';
import { gravatarAvatar } from './avatars';

export interface CommentNames {
  agent: (artifact?: ArtifactRef) => string | undefined;
  human: () => Person | undefined;
}

interface Options {
  agentFile: string;
  artifact?: ArtifactRef;
  projectDir: string;
}

function gitConfig(cwd: string, key: string): string | undefined {
  try {
    return (
      execFileSync('git', ['config', key], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function gitPerson(cwd: string): Person | undefined {
  const name = gitConfig(cwd, 'user.name');
  if (!name) return undefined;
  const email = gitConfig(cwd, 'user.email');
  return email ? { name, avatar: gravatarAvatar(email) } : { name };
}

export function artifactAgentFile(projectAgentFile: string, { type, id }: ArtifactRef) {
  return path.join(path.dirname(projectAgentFile), type, id, 'agent');
}

function recordedAgent(file: string) {
  try {
    return detectAgent(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>);
  } catch {
    return undefined;
  }
}

export function commentNames({ agentFile, artifact, projectDir }: Options): CommentNames {
  let git: { person: Person | undefined } | undefined;
  return {
    human: () => {
      git ??= { person: gitPerson(projectDir) };
      return git.person;
    },
    agent: (target = artifact) =>
      (target && recordedAgent(artifactAgentFile(agentFile, target))) ?? recordedAgent(agentFile),
  };
}
