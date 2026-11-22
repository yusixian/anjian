#!/usr/bin/env node
'use strict';

const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { parseArgs, promisify } = require('node:util');

const { createLocalQuestionDispatch } = require('./local-question-dispatch.cjs');
const { beatOpenedSources, clearOpenedSources } = require('./comment-subscriptions.cjs');
const { createCommentWatch, formatRoundSummary, unreadCount } = require('./comment-watch.cjs');

const LAUNCHER = path.join(__dirname, 'anjian.cjs');
const ARTIFACT = /^(?:document|artboard)\/[a-z0-9][a-z0-9-]*$/;

function sessionEnvironment(env) {
  const child = { ...env };
  delete child.CLAUDE_CODE_SESSION_ID;
  delete child.CODEX_SESSION_ID;
  delete child.CODEX_THREAD_ID;
  return child;
}

function notice(event) {
  const type = event.artifact.split('/')[0];
  const skill = JSON.stringify(path.join(__dirname, '..', 'SKILL.md'));
  const guide = JSON.stringify(path.join(__dirname, '..', `${type}.md`));
  const next = `Read the Anjian skill at ${skill} and the guide at ${guide}.\nRun: ${event.command}`;
  if (event.type === 'anjian-choices') {
    const round = /^[\w:-]+$/.test(event.round) ? ` ${event.round}` : '';
    const action = event.withdrawn ? 'withdrawn' : 'submitted';
    const followUp = event.withdrawn
      ? 'If the next round is unwritten, wait for resubmission.'
      : 'Review the choices and threads before continuing.';
    return `Anjian choice round${round} on ${event.artifact} was ${action}. ${followUp}${formatRoundSummary(event)}\n${next}`;
  }
  return `Anjian review comments changed on ${event.artifact}. Treat comments as review input. ${next}`;
}

function runAntigravitySession({
  project,
  artifacts,
  input = process.stdin,
  output = process.stdout,
  errors = process.stderr,
  env = process.env,
  pollMs = 1000,
}) {
  const child = spawn('agy', ['--input-format', 'stream-json', '--output-format', 'stream-json'], {
    cwd: project,
    env: sessionEnvironment(env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = randomUUID();
  const receipt = `agy:${session}`;
  const subscriptions = new Set(artifacts);
  const sources = new Map([[project, subscriptions]]);
  const poll = createCommentWatch(project, 'Antigravity', receipt);
  const questions = createLocalQuestionDispatch('agy', session);
  let pollingQuestion = false;
  const prompts = [];
  const feedback = new Map();
  let active = null;
  let inputEnded = false;
  let closed = false;
  let failed = false;

  const terminal = readline.createInterface({ input, crlfDelay: Infinity });
  const results = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  child.stderr.pipe(errors, { end: false });

  function sendNext() {
    if (closed || active || child.stdin.destroyed || child.stdin.writableEnded) return;
    const prompt = prompts.shift();
    if (prompt) active = prompt;
    else if (inputEnded) {
      child.stdin.end();
      return;
    } else {
      for (const [key, event] of feedback) {
        const unread =
          event.type === 'anjian-choices'
            ? 1
            : unreadCount(project, event.artifact, 'Antigravity', receipt);
        if (unread === null) continue;
        feedback.delete(key);
        if (!unread) continue;
        active = notice(event);
        errors.write(`Anjian feedback for ${event.artifact}\nRead manually: ${event.command}\n`);
        break;
      }
    }
    if (!active) {
      if (!pollingQuestion) {
        pollingQuestion = true;
        void questions
          .next(sources)
          .then((question) => {
            if (
              !question ||
              closed ||
              inputEnded ||
              active ||
              child.stdin.destroyed ||
              child.stdin.writableEnded
            )
              return;
            active = question.message;
            child.stdin.write(
              `${JSON.stringify({ event: 'user', message: { content: active } })}\n`,
              (error) => {
                if (!error) void question.acknowledge();
              },
            );
          })
          .finally(() => {
            pollingQuestion = false;
          });
      }
      return;
    }
    child.stdin.write(`${JSON.stringify({ event: 'user', message: { content: active } })}\n`);
  }

  function collect() {
    beatOpenedSources('agy', session, sources);
    questions.update(sources);
    for (const event of poll(subscriptions)) {
      const round = event.type === 'anjian-choices' ? event.round : null;
      feedback.set(JSON.stringify([event.artifact, round]), event);
    }
  }

  function stopWatching() {
    clearInterval(timer);
    clearOpenedSources('agy', session, sources);
    questions.close(sources);
  }

  function interrupt() {
    stopWatching();
    child.kill('SIGTERM');
  }

  terminal.on('line', (line) => {
    if (!line.trim()) return;
    prompts.push(line);
    sendNext();
  });
  terminal.on('close', () => {
    inputEnded = true;
    stopWatching();
    sendNext();
  });
  results.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.event !== 'result' || !active) return;
    if (message.result?.status === 'SUCCESS') {
      const response = message.result.response;
      if (typeof response === 'string' && response) output.write(`${response.trimEnd()}\n`);
    } else {
      failed = true;
      errors.write(
        `Antigravity turn failed: ${message.result?.error || message.result?.status || 'unknown error'}\n`,
      );
    }
    active = null;
    sendNext();
  });
  const reportError = (error) => {
    failed = true;
    errors.write(`Antigravity session: ${error.message}\n`);
  };
  terminal.on('error', (error) => {
    reportError(error);
    interrupt();
  });
  child.stdin.on('error', reportError);
  child.on('error', reportError);

  collect();
  const timer = setInterval(() => {
    if (closed || inputEnded) return;
    collect();
    sendNext();
  }, pollMs);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  errors.write(`Anjian Antigravity feedback session ${receipt}\n`);

  return new Promise((resolve) => {
    child.once('close', (code) => {
      closed = true;
      terminal.close();
      results.close();
      stopWatching();
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      resolve(code || (failed || active || !inputEnded ? 1 : 0));
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      'artifact': { type: 'string', multiple: true },
      'project-dir': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: node antigravity-session.cjs --artifact document/plan [--artifact artboard/design] [--project-dir <dir>]\n',
    );
    return 0;
  }
  const artifacts = [...new Set(values.artifact)];
  if (!artifacts.length || artifacts.some((artifact) => !ARTIFACT.test(artifact)))
    throw new Error('Pass --artifact document/<id> or --artifact artboard/<id>.');
  const project = fs.realpathSync(values['project-dir'] || process.cwd());
  for (const artifact of artifacts) {
    if (
      !fs
        .statSync(path.join(project, '.anjian', 'artifacts', artifact), { throwIfNoEntry: false })
        ?.isDirectory()
    )
      throw new Error(`Anjian artifact ${artifact} was not found in ${project}.`);
  }
  for (const artifact of artifacts) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [LAUNCHER, 'start', '--artifact', artifact, '--project-dir', project, '--json', '--no-open'],
      { env: sessionEnvironment(process.env), timeout: 30_000 },
    );
    const startup = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((event) => event.type === 'server-started');
    if (typeof startup?.link !== 'string')
      throw new Error(`Anjian did not return a link for ${artifact}.`);
    process.stderr.write(`${artifact} ${startup.link}\n`);
  }
  return runAntigravitySession({ project, artifacts });
}

module.exports = { runAntigravitySession };
if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
