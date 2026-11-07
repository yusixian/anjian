import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { commentNames } from '../src/server/comment-names';

function setup(gitName?: string, gitEmail?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-names-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (gitName) execFileSync('git', ['config', 'user.name', gitName], { cwd: dir });
  if (gitEmail) execFileSync('git', ['config', 'user.email', gitEmail], { cwd: dir });
  return {
    dir,
    agentFile: path.join(dir, 'agent'),
  };
}

describe('commentNames', () => {
  test('the human uses the project git user and Gravatar', () => {
    const { dir, agentFile } = setup('Git Name', ' Git@Example.com ');
    expect(commentNames({ agentFile, projectDir: dir }).human()).toEqual({
      name: 'Git Name',
      avatar: '/api/avatar/gravatar/c2695de4a87d7f4470ee32f01c25b264876f4da96e3241dd50f51184381ec8fd',
    });
  });

  test('the agent is detected from the recorded markers, and re-read on each call', () => {
    const { dir, agentFile } = setup();
    const names = commentNames({ agentFile, projectDir: dir });
    expect(names.agent()).toBeUndefined();
    fs.writeFileSync(agentFile, JSON.stringify({ AI_AGENT: 'claude-code_2-1-304_agent' }));
    expect(names.agent()).toBe('Claude Code');
    fs.writeFileSync(agentFile, JSON.stringify({ CODEX_THREAD_ID: 'x' }));
    expect(names.agent()).toBe('Codex');
  });

  test('a corrupt agent file names no one', () => {
    const { dir, agentFile } = setup();
    fs.writeFileSync(agentFile, 'nope');
    expect(commentNames({ agentFile, projectDir: dir }).agent()).toBeUndefined();
  });
});
