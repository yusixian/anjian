import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { version } from '../package.json';
import { AGENT_MARKERS } from '../src/server/agent';
import { machinePaths, readProjects } from '../src/server/machine';
import { registryDir, writeEntry } from '../src/server/registry';
import { get, waitFor } from './helpers';

const cli = path.resolve(__dirname, '../../skills/artifacts/app/cli.cjs');
const localLauncher = path.join(path.dirname(cli), 'anjian.cjs');

const withoutAgent = () =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !AGENT_MARKERS.includes(key)));

let isolation: NodeJS.ProcessEnv = {};

beforeEach(() => {
  isolation = {
    ANJIAN_SERVER_HOME: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-home-')), 's'),
    ANJIAN_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-runtime-')),
    ANJIAN_ARTIFACTS_PORTS: '0',
    ANJIAN_ARTIFACTS_BOARD_PORTS: '0',
    ANJIAN_NO_UPDATE_CHECK: '1',
  };
});

afterEach(async () => {
  spawnSync(process.execPath, [cli, 'stop'], {
    timeout: 15000,
    env: { ...process.env, ...isolation },
  });
});

const baseEnv = (env: NodeJS.ProcessEnv = {}) => ({
  ...withoutAgent(),
  ARTIFACTS_OPEN: '0',
  ...isolation,
  ...env,
});

const run = (args: string[], env: NodeJS.ProcessEnv = {}, entry = cli) => {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: baseEnv(env),
  });
  return {
    code: result.status,
    out: JSON.parse(result.stdout.trim().split('\n').pop()!),
    stderr: result.stderr.trim(),
  };
};

const runAsync = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  new Promise<{ out: any }>((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: baseEnv(env) });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('close', () => resolve({ out: JSON.parse(stdout.trim().split('\n').pop()!) }));
  });

const machine = () => machinePaths(isolation);
const serverPid = () => Number(fs.readFileSync(machine().pid, 'utf8'));
const hubEvents = () =>
  fs
    .readFileSync(machine().events, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));

function newProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-project-'));
}

const stateOf = (project: string) => path.join(project, '.anjian', 'artifacts', '.state');

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

function writeReadyArtboard(project: string, id: string) {
  const artboard = path.join(project, '.anjian', 'artifacts', 'artboard', id);
  fs.mkdirSync(path.join(artboard, 'pages', 'p'), { recursive: true });
  fs.writeFileSync(path.join(artboard, 'pages', 'p', 'a.html'), '<p>ready</p>');
  fs.writeFileSync(
    path.join(artboard, 'canvas.json'),
    JSON.stringify({
      version: 1,
      pages: [{ id: 'p', name: 'P' }],
      boards: { a: { file: 'pages/p/a.html', page: 'p', x: 0, y: 0, w: 640, h: 400 } },
    }),
  );
}

function openRecorder() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-open-bin-'));
  const log = path.join(bin, 'opened.log');
  const open = path.join(bin, 'open');
  fs.writeFileSync(open, `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(log)}\n`, {
    mode: 0o755,
  });
  return { log, open };
}

describe('anjian start', () => {
  test('starts the machine server, registers the project and prints its url as one JSON line', async () => {
    const project = newProject();
    const { code, out } = run(['start', '--project-dir', project]);
    expect(code).toBe(0);
    expect(out.type).toBe('server-started');
    expect(out).not.toHaveProperty('mockupGuide');
    expect(out.root).toBe(fs.realpathSync(path.join(project, '.anjian', 'artifacts')));
    expect(out.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect((await get(out.url.replace('localhost', '127.0.0.1'))).status).toBe(200);
    expect(readProjects(machine().projects).map((entry) => entry.dir)).toEqual([
      fs.realpathSync(project),
    ]);
    expect(fs.statSync(machine().info).mode & 0o077).toBe(0);
    expect(
      JSON.parse(fs.readFileSync(path.join(stateOf(project), 'server-info'), 'utf8')).url,
    ).toBe(out.url);
  }, 30000);

  test('returns the bundled phone mockup guide on fresh and reused starts', () => {
    const project = newProject();
    const args = ['start', '--mockup', '--project-dir', project, '--artifact', 'artboard/booking'];
    const first = run(args);
    expect(first.code).toBe(0);
    expect(new URL(first.out.link).pathname).toMatch(/^\/artboard\/[A-Za-z0-9]{21}$/);
    expect(first.out.mockupGuide).toContain('# Phone mockups');
    const reused = run(args);
    expect(reused.out.reused).toBe(true);
    expect(reused.out.link).toBe(first.out.link);
    expect(reused.out.mockupGuide).toBe(first.out.mockupGuide);
  }, 30000);

  test('two projects share one server process and one port', () => {
    const one = newProject();
    const two = newProject();
    const first = run(['start', '--project-dir', one, '--artifact', 'html/a']).out;
    const pid = serverPid();
    const second = run(['start', '--project-dir', two, '--artifact', 'html/b']).out;
    expect(second.reused).toBe(true);
    expect(second.port).toBe(first.port);
    expect(serverPid()).toBe(pid);
    expect(second.root).toBe(fs.realpathSync(path.join(two, '.anjian', 'artifacts')));
    expect(readProjects(machine().projects)).toHaveLength(2);
  }, 30000);

  test('records the agent of each start, and a start outside any agent keeps the last one', () => {
    const project = newProject();
    const agentFile = path.join(stateOf(project), 'agent');
    run(['start', '--project-dir', project], {
      AI_AGENT: 'claude-code_2-1-304_agent',
      CLAUDECODE: '1',
    });
    expect(JSON.parse(fs.readFileSync(agentFile, 'utf8'))).toEqual({
      AI_AGENT: 'claude-code_2-1-304_agent',
      CLAUDECODE: '1',
    });
    expect(run(['start', '--project-dir', project], { CODEX_THREAD_ID: 't1' }).out.reused).toBe(
      true,
    );
    expect(JSON.parse(fs.readFileSync(agentFile, 'utf8'))).toEqual({ CODEX_THREAD_ID: 't1' });
    run(['start', '--project-dir', project]);
    expect(JSON.parse(fs.readFileSync(agentFile, 'utf8'))).toEqual({ CODEX_THREAD_ID: 't1' });
  }, 30000);

  test('explicit launches keep each artifact agent and leave legacy attribution readable', async () => {
    const project = newProject();
    for (const id of ['one', 'two', 'legacy']) writeReadyArtboard(project, id);
    const args = ['start', '--project-dir', project];
    const initial = run(args, { AI_AGENT: 'gemini' });
    expect(initial.code).toBe(0);
    const origin = new URL(initial.out.url.replace('localhost', '127.0.0.1')).origin;
    const launch = (id: string, env?: NodeJS.ProcessEnv) => {
      expect(run([...args, '--artifact', `artboard/${id}`], env).code).toBe(0);
    };
    launch('one', { AI_AGENT: 'claude' });
    launch('two', { AI_AGENT: 'codex' });
    launch('one', { AGENT: '1' });
    for (const [id, name] of [
      ['one', 'Claude Code'],
      ['two', 'Codex'],
      ['legacy', 'Gemini CLI'],
    ]) {
      const response = await fetch(`${origin}/api/artifacts/artboard/${id}`);
      expect(response.status).toBe(200);
      expect((await response.json()).agent).toBe(name);
    }
    const artboard = path.join(project, '.anjian/artifacts/artboard/one');
    const created = await fetch(`${origin}/api/artboard/one/comments`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'create',
        anchor: { page: 'p', board: 'a', x: 10, y: 10 },
        text: 'Check the default reply name',
      }),
    });
    expect(created.status).toBe(200);
    const { comments } = await created.json();
    const reply = [
      'comment',
      'reply',
      '--project-dir',
      project,
      '--artifact',
      'artboard/one',
      '--thread',
      comments.threads[0].id,
      '--text',
      'Reviewed',
    ];
    const defaultReply = run(reply);
    expect(defaultReply.code, JSON.stringify(defaultReply)).toBe(0);
    const explicitReply = run(reply, { AI_AGENT: 'codex' });
    expect(explicitReply.code, JSON.stringify(explicitReply)).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(artboard, 'comments.json'), 'utf8'));
    expect(
      saved.threads[0].messages.slice(1).map((message: { name: string }) => message.name),
    ).toEqual(['Claude Code', 'Codex']);
  }, 30000);

  test('a start from a subdirectory of the repository registers the root', () => {
    const project = newProject();
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(project, 'packages', 'app'), { recursive: true });
    const first = run(['start', '--project-dir', project]).out;
    const second = run(['start', '--project-dir', path.join(project, 'packages', 'app')]).out;
    expect(second.url).toBe(first.url);
    expect(second.reused).toBe(true);
    expect(second.root).toBe(fs.realpathSync(path.join(project, '.anjian', 'artifacts')));
  }, 30000);

  test('the skill launcher resolves a subdirectory to the repository root', () => {
    const project = newProject();
    fs.mkdirSync(path.join(project, '.git'));
    fs.mkdirSync(path.join(project, 'packages', 'app'), { recursive: true });
    const launcher = path.resolve(__dirname, '../../skills/artifacts/app/anjian.cjs');
    const result = spawnSync(
      process.execPath,
      [launcher, 'start', '--json', '--project-dir', path.join(project, 'packages', 'app')],
      { encoding: 'utf8', timeout: 20000, env: baseEnv() },
    );
    expect(JSON.parse(result.stdout.trim().split('\n').pop()!).root).toBe(
      fs.realpathSync(path.join(project, '.anjian', 'artifacts')),
    );
  }, 30000);

  test('a start stops servers of the old per-project kind', async () => {
    const project = newProject();
    const id = 'b'.repeat(48);
    const old = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', `--artifacts-server-id=${id}`],
      { stdio: 'ignore' },
    );
    const real = fs.realpathSync(project);
    writeEntry(registryDir(isolation), {
      project: real,
      root: path.join(real, '.anjian', 'artifacts'),
      pid: old.pid!,
      serverId: id,
      startedAt: 1,
    });
    run(['start', '--project-dir', project]);
    await waitFor(() => {
      try {
        process.kill(old.pid!, 0);
        return false;
      } catch {
        return true;
      }
    }, 5000);
  }, 30000);

  test('concurrent starts share one server that stop then stops', async () => {
    const [a, b] = await Promise.all([
      runAsync(['start', '--project-dir', newProject()]),
      runAsync(['start', '--project-dir', newProject()]),
    ]);
    expect(a.out.port).toBe(b.out.port);
    const pid = serverPid();
    if (process.platform === 'darwin') {
      const command = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      });
      expect(command.stdout.trim()).toMatch(
        new RegExp(
          `^Anjian ${version.replaceAll('.', '\\.')} Hub --artifacts-server-id=[a-f0-9]{48}$`,
        ),
      );
    }
    expect(run(['stop']).out.status).toBe('stopped');
    expect(() => process.kill(pid, 0)).toThrow();
  }, 30000);

  test('opens the requested artifact once it is ready, by default', async () => {
    const project = newProject();
    writeReadyArtboard(project, 'header');
    const { log, open } = openRecorder();
    const { out } = await runAsync(
      ['start', '--project-dir', project, '--artifact', 'artboard/header'],
      { ARTIFACTS_OPEN: '1', ARTIFACTS_OPEN_CMD: open },
    );
    expect(out.type).toBe('server-started');
    await waitFor(() => fs.existsSync(log), 5000);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/\/artboard\/[A-Za-z0-9]{21}(\s|$)/);
  }, 20000);

  test('a second project on a running server still opens its artifact', async () => {
    run(['start', '--project-dir', newProject()]);
    const project = newProject();
    writeReadyArtboard(project, 'header');
    const { log, open } = openRecorder();
    const { out } = await runAsync(
      ['start', '--project-dir', project, '--artifact', 'artboard/header'],
      { ARTIFACTS_OPEN: '1', ARTIFACTS_OPEN_CMD: open },
    );
    expect(out.reused).toBe(true);
    await waitFor(() => fs.existsSync(log), 5000);
  }, 20000);

  test('prints a link for an artifact, on start and on reuse', () => {
    const project = newProject();
    const first = run(['start', '--project-dir', project, '--artifact', 'html/arrow-tuner']).out;
    expect(new URL(first.link).pathname).toMatch(/^\/html\/[A-Za-z0-9]{21}$/);
    expect(new URL(first.link).searchParams.has('key')).toBe(false);
    expect(
      run(['start', '--project-dir', project, '--artifact', 'html/arrow-tuner']).out.link,
    ).toBe(first.link);
    const second = run(['start', '--project-dir', project, '--artifact', 'artboard/header']).out;
    expect(second.reused).toBe(true);
    expect(new URL(second.link).pathname).toMatch(/^\/artboard\/[A-Za-z0-9]{21}$/);
    expect(new URL(second.link).origin).toBe(`http://localhost:${first.port}`);
  }, 30000);

  test('rejects an invalid artifact name, port and unknown arguments with exit code 1', () => {
    const bad = run(['start', '--project-dir', newProject(), '--artifact', 'html/../x']);
    expect(bad.code).toBe(1);
    expect(bad.out.error).toMatch(/--artifact must be/);
    expect(run(['start', '--project-dir', newProject(), '--port', 'x']).out.error).toMatch(
      /--port/,
    );
    const unknown = run(['start', '--nope']);
    expect(unknown.code).toBe(1);
    expect(unknown.out.error).toMatch(/Unknown argument/);
  });

  test('detects its running server even where ps has no -o option', () => {
    const project = newProject();
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-ps-'));
    fs.writeFileSync(
      path.join(shim, 'ps'),
      '#!/bin/bash\nfor a in "$@"; do [[ "$a" == "-o" ]] && exit 1; done\nexec /bin/ps "$@"\n',
      { mode: 0o755 },
    );
    const env = { PATH: `${shim}:${process.env.PATH}` };
    const first = run(['start', '--project-dir', project], env).out;
    const second = run(['start', '--project-dir', project], env).out;
    expect(second.reused).toBe(true);
    expect(second.url).toBe(first.url);
    expect(run(['stop'], env).out.status).toBe('stopped');
  }, 30000);

  test('a restart from the home page comes back on the same port without marking a stop', async () => {
    const port = await freePort();
    isolation.ANJIAN_ARTIFACTS_PORTS = String(port);
    const project = newProject();
    run(['start', '--project-dir', project]);
    const oldPid = serverPid();
    const res = await fetch(`http://127.0.0.1:${port}/api/hub/restart`, { method: 'POST' });
    expect(res.status).toBe(202);
    await waitFor(() => {
      try {
        const pid = serverPid();
        return Number.isInteger(pid) && pid > 0 && pid !== oldPid;
      } catch {
        return false;
      }
    }, 15000);
    let status = 0;
    for (let tries = 0; tries < 50 && status !== 200; tries++) {
      status = await get(`http://127.0.0.1:${port}/api/status`)
        .then((r) => r.status)
        .catch(() => 0);
      if (status !== 200) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status).toBe(200);
    expect(() => process.kill(serverPid(), 0)).not.toThrow();
    expect(fs.existsSync(machine().stopped)).toBe(false);
    expect(() => process.kill(oldPid, 0)).toThrow();
    expect(hubEvents()).toEqual([
      expect.objectContaining({ action: 'replace', reason: 'browser', pid: oldPid }),
    ]);
    const newPid = serverPid();
    const stop = await fetch(`http://127.0.0.1:${port}/api/hub/stop`, { method: 'POST' });
    expect(stop.status).toBe(202);
    await waitFor(() => hubEvents().some((event) => event.action === 'stop'), 5000);
    expect(hubEvents().at(-1)).toMatchObject({ action: 'stop', reason: 'browser', pid: newPid });
  }, 40000);

  test('a start while the server is shutting down waits for it instead of starting a second one', async () => {
    const first = await freePort();
    const second = await freePort();
    isolation.ANJIAN_ARTIFACTS_PORTS = `${first},${second}`;
    const project = newProject();
    run(['start', '--project-dir', project]);
    const oldPid = serverPid();
    fs.rmSync(machine().info);
    const again = run(['start', '--project-dir', project]).out;
    expect(again.port).toBe(first);
    expect(() => process.kill(oldPid, 0)).toThrow();
  }, 40000);

  test('only a newer release replaces the running server, which comes back on the same port', async () => {
    isolation.ANJIAN_ARTIFACTS_PORTS = String(await freePort());
    const project = newProject();
    const first = run(['start', '--project-dir', project], {
      ANJIAN_ARTIFACTS_VERSION: '9.9.8',
    }).out;
    const oldPid = serverPid();
    const older = run(['start', '--project-dir', project], { ANJIAN_ARTIFACTS_VERSION: '9.9.7' });
    expect(older.out.reused).toBe(true);
    expect(older.out.hint).toMatch(/9\.9\.8/);
    expect(serverPid()).toBe(oldPid);
    const newer = run(['start', '--project-dir', project], {
      ANJIAN_ARTIFACTS_VERSION: '9.9.9',
    }).out;
    expect(newer.reused).toBeUndefined();
    expect(newer.url).toBe(first.url);
    expect(() => process.kill(oldPid, 0)).toThrow();
  }, 40000);

  test('a start with another host replaces the running server', () => {
    const project = newProject();
    run(['start', '--project-dir', project]);
    const oldPid = serverPid();
    const replaced = run(['start', '--project-dir', project, '--url-host', '127.0.0.1']).out;
    expect(replaced.reused).toBeUndefined();
    expect(replaced.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(() => process.kill(oldPid, 0)).toThrow();
  }, 30000);

  test('a release CLI keeps a healthy source Hub and reports conflicting settings', () => {
    const args = ['start', '--project-dir', newProject(), '--no-open'];
    const local = run(args, {}, localLauncher);
    expect(local.code).toBe(0);
    const pid = serverPid();
    const info = fs.readFileSync(machine().info, 'utf8');
    const release = run(args);
    expect(release.out).toMatchObject({ reused: true, url: local.out.url });

    const conflicting = run([...args, '--url-host', '127.0.0.1']);
    expect(conflicting.code).toBe(1);
    expect(conflicting.out.error).toMatch(/Kept the running local Anjian Hub.*stop/);
    expect(serverPid()).toBe(pid);
    expect(fs.readFileSync(machine().info, 'utf8')).toBe(info);
    expect(run(['stop']).out.status).toBe('stopped');
    expect(hubEvents()).toEqual([
      expect.objectContaining({ action: 'keep', reason: 'local-build', pid }),
      expect.objectContaining({ action: 'keep', reason: 'local-build-settings', pid }),
      expect.objectContaining({ action: 'stop', reason: 'cli', pid }),
    ]);
    expect(Object.keys(hubEvents()[0]).sort()).toEqual(['action', 'pid', 'reason', 'timestamp']);
    expect(fs.statSync(machine().events).mode & 0o777).toBe(0o600);
  }, 30000);

  test('a release CLI replaces an unresponsive source Hub', () => {
    const project = newProject();
    run(['start', '--project-dir', project], {}, localLauncher);
    const pid = serverPid();
    process.kill(pid, 'SIGSTOP');
    try {
      const out = run(['start', '--project-dir', project]).out;
      expect(out.type).toBe('server-started');
      expect(out.reused).toBeUndefined();
      expect(serverPid()).not.toBe(pid);
      expect(hubEvents()).toEqual([
        expect.objectContaining({ action: 'replace', reason: 'unresponsive', pid }),
      ]);
    } finally {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }, 40000);

  test('a foreground start passes the server through and stops with it', async () => {
    const project = newProject();
    const child = spawn(
      process.execPath,
      [cli, 'start', '--project-dir', project, '--foreground', '--artifact', 'html/x'],
      { env: baseEnv() },
    );
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    const exited = new Promise((resolve) => child.on('close', resolve));
    await waitFor(() => out.includes('"link"'), 10000);
    const started = out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((line) => line.link);
    expect(started.link).toMatch(/\/html\/[A-Za-z0-9]{21}$/);
    process.kill(serverPid(), 'SIGTERM');
    await exited;
  }, 30000);
});

describe('anjian stop', () => {
  test('stops the server, keeps the state directories and clears every server-info', async () => {
    const project = newProject();
    const info = run(['start', '--project-dir', project]).out;
    expect(run(['stop']).out.status).toBe('stopped');
    await expect(get(info.url.replace('localhost', '127.0.0.1'))).rejects.toThrow();
    expect(fs.existsSync(stateOf(project))).toBe(true);
    expect(fs.existsSync(path.join(stateOf(project), 'server-info'))).toBe(false);
    expect(fs.existsSync(machine().info)).toBe(false);
    expect(JSON.parse(fs.readFileSync(machine().stopped, 'utf8')).reason).toBe('stop');
  }, 30000);

  test('accepts and ignores --project-dir', () => {
    run(['start', '--project-dir', newProject()]);
    expect(run(['stop', '--project-dir', newProject()]).out.status).toBe('stopped');
  }, 30000);

  test('refuses to signal a pid that is not the server', () => {
    fs.mkdirSync(machine().home, { recursive: true });
    const foreign = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    try {
      fs.writeFileSync(machine().pid, `${foreign.pid}\n`);
      fs.writeFileSync(machine().serverId, `${'a'.repeat(48)}\n`);
      expect(run(['stop']).out.status).toBe('stale_pid');
      expect(() => process.kill(foreign.pid!, 0)).not.toThrow();
    } finally {
      foreign.kill();
    }
  });

  test('reports not_running when nothing was started', () => {
    expect(run(['stop']).out.status).toBe('not_running');
  });
});
