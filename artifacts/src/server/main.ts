import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { version } from '../../package.json';
import { openBrowser } from './browser-focus';
import { startHub } from './hub';
import { parseEnv } from './lifecycle';
import { ensureHome, machinePaths } from './machine';
import { relaunchCommand, spawnAfterExit } from './relaunch';
import { writeJsonAtomic } from './state';

function machineKey(file: string) {
  try {
    const key = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(key)) return key;
  } catch {}
  const key = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600 });
  return key;
}

async function main() {
  const config = parseEnv(process.env, process.argv.slice(2));
  const paths = machinePaths();
  ensureHome(paths.home);
  const hub = await startHub({
    host: config.host,
    urlHost: config.urlHost,
    viewerDir: path.join(__dirname, 'viewer'),
    runtimeDir: path.join(__dirname, 'runtime'),
    ports: config.ports,
    boardPorts: config.boardPorts,
    paths,
    token: machineKey(paths.key),
    version,
    publicOrigin: config.publicOrigin,
    boardOrigin: config.boardOrigin,
    control: {
      stop: () => void shutdown('stop'),
      relaunch,
    },
    open: async (link, local, openCmd) => {
      const command = openCmd ?? config.openCmd;
      if (command) {
        exec(`${command} ${JSON.stringify(link)}`, () => {});
        return;
      }
      await openBrowser(link, [local]).catch((error: Error) => {
        console.error(JSON.stringify({ type: 'browser-open-error', error: error.message }));
      });
    },
  });

  let stopping = false;
  async function shutdown(reason: string, intended = true) {
    if (stopping) return;
    stopping = true;
    console.info(JSON.stringify({ type: 'server-stopped', reason }));
    fs.rmSync(paths.info, { force: true });
    if (intended) writeJsonAtomic(paths.stopped, { reason, timestamp: Date.now() });
    await hub.close();
    process.exit(0);
  }

  function relaunch() {
    const command = relaunchCommand(process.env, __dirname);
    const project = hub.projects()[0]?.dir;
    if (!command || !project) return false;
    const env = { ...process.env };
    delete env.CODEX_CI;
    spawnAfterExit(
      process.pid,
      [
        ...command,
        'start',
        '--json',
        '--no-open',
        '--project-dir',
        project,
        '--host',
        config.host,
        '--url-host',
        config.urlHost,
        '--port',
        String(hub.port),
      ],
      env,
    );
    setImmediate(() => void shutdown('restart', false));
    return true;
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGHUP', () => void shutdown('SIGHUP'));

  fs.rmSync(paths.stopped, { force: true });
  const started = {
    type: 'server-started',
    url: hub.url,
    localUrl: hub.localUrl,
    port: hub.port,
    boardPort: hub.boardPort,
    version,
    pid: process.pid,
    host: config.host,
    urlHost: config.urlHost,
    publicOrigin: config.publicOrigin,
    boardOrigin: config.boardOrigin,
  };
  writeJsonAtomic(paths.info, started);
  console.info(JSON.stringify(started));
}

main().catch((err) => {
  console.info(JSON.stringify({ type: 'server-error', error: (err as Error).message }));
  process.exit(1);
});
