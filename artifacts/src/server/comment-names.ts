import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

import type { Person } from '../shared/comments';
import { detectAgent } from './agent';
import { gravatarAvatar } from './avatars';

export interface CommentNames {
  agent: () => string | undefined;
  human: () => Person | undefined;
}

interface Options {
  agentFile: string;
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

export function commentNames({ agentFile, projectDir }: Options): CommentNames {
  let git: { person: Person | undefined } | undefined;
  return {
    human: () => {
      git ??= { person: gitPerson(projectDir) };
      return git.person;
    },
    agent: () => {
      try {
        return detectAgent(
          JSON.parse(fs.readFileSync(agentFile, 'utf8')) as Record<string, string>,
        );
      } catch {
        return undefined;
      }
    },
  };
}
