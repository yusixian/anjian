#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const win32 = process.platform === 'win32';

function localVersion() {
  const hash = nodeCrypto.createHash('sha256');
  for (const name of ['cli.cjs', 'server.cjs']) {
    try {
      hash.update(`${name}\0`);
      hash.update(fs.readFileSync(path.join(__dirname, name)));
    } catch {}
  }
  return `local-${hash.digest('hex').slice(0, 12)}`;
}

function ownerPid() {
  if (win32) return null;
  const result = spawnSync('ps', ['-o', 'ppid=', '-p', String(process.ppid)], { encoding: 'utf8' });
  const parent = Number((result.stdout || '').trim());
  return Number.isInteger(parent) && parent > 1 ? parent : process.ppid;
}

function main() {
  const cli = path.join(__dirname, 'cli.cjs');
  if (!fs.existsSync(cli)) {
    throw new Error(
      'Anjian has not been built. Run pnpm install --frozen-lockfile and pnpm build in the artifacts directory. No upstream package will be downloaded.',
    );
  }
  const args = process.argv.slice(2);
  const end = args.indexOf('--');
  const flags = end === -1 ? args : args.slice(0, end);
  const readOnly =
    args[0] === 'skills' ||
    flags.includes('--help') ||
    flags.includes('-h') ||
    args[0] === '--version' ||
    args[0] === '-v' ||
    (args[0] === 'remote' && args[1] === 'status');
  if (!readOnly && (process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID)) {
    try {
      require('./comment-subscriptions.cjs').register(args);
    } catch (error) {
      console.error(JSON.stringify({ type: 'comment-watch-error', message: error.message }));
    }
  }
  const env = {
    ...process.env,
    ANJIAN_ARTIFACTS_COMMAND: `node "${__filename}"`,
    ANJIAN_ARTIFACTS_RESOLVE_ROOT: '1',
    ANJIAN_ARTIFACTS_VERSION: localVersion(),
  };
  const given = Number(env.ANJIAN_ARTIFACTS_OWNER);
  const owner = Number.isInteger(given) && given > 1 ? given : ownerPid();
  if (owner) env.ANJIAN_ARTIFACTS_OWNER = String(owner);
  const child = spawn(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
