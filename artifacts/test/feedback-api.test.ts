import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, expect, test, vi } from 'vitest';

import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { createStorageSettings } from '../src/server/storage/settings';
import { createStorageUsage } from '../src/server/storage/usage';
import { tempRoot } from './helpers';

const MASTER = 'm'.repeat(48);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function reservePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-remote-api-')));
  const home = path.join(root, 'server');
  const alpha = path.join(root, 'alpha');
  const beta = path.join(root, 'beta');
  for (const project of [alpha, beta])
    fs.mkdirSync(path.join(project, '.anjian', 'artifacts'), { recursive: true });
  const temp = tempRoot();
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const paths = machinePaths({ ANJIAN_SERVER_HOME: home });
  const active: Hub[] = [];
  async function start() {
    const hub = await startHub({
      host: '127.0.0.1',
      urlHost: '127.0.0.1',
      publicOrigin: origin,
      ports: [port],
      boardPorts: [0],
      viewerDir: temp.viewer,
      runtimeDir: temp.runtime,
      paths,
      token: MASTER,
      version: '0.1.0',
      debounceMs: 20,
    });
    active.push(hub);
    return hub;
  }
  let hub = await start();
  await hub.register(alpha);
  await hub.register(beta);
  cleanups.push(async () => {
    await Promise.all(active.map((item) => item.close().catch(() => undefined)));
    fs.rmSync(root, { recursive: true, force: true });
    for (const dir of [temp.root, temp.viewer, temp.runtime])
      fs.rmSync(dir, { recursive: true, force: true });
  });
  const id = (dir: string) => crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  const request = (route: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    // The fixture restarts on the same port; do not reuse pre-restart pooled sockets.
    headers.set('Connection', 'close');
    return fetch(`${origin}${route}`, { ...init, headers });
  };
  async function login() {
    const pair = await request('/api/remote/auth/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test CLI' }),
    });
    expect(pair.status).toBe(200);
    const { deviceCode, userCode } = (await pair.json()) as {
      deviceCode: string;
      userCode: string;
    };
    const loginPage = await request(`/connect?code=${userCode}`, { redirect: 'manual' });
    expect(loginPage.status).toBe(303);
    expect(loginPage.headers.get('location')).toBe(
      '/login?returnTo=' + encodeURIComponent(`/connect?code=${userCode}`),
    );
    const approve = await request(`/api/remote/auth/approve?key=${MASTER}`, {
      method: 'POST',
      headers: { 'Origin': origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: userCode, projects: [id(alpha)] }),
    });
    expect(approve.status).toBe(200);
    const claimed = await request('/api/remote/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    });
    expect(claimed.status).toBe(200);
    const { token } = (await claimed.json()) as { token: string };
    return { token, headers: { Authorization: `Bearer ${token}` } };
  }
  async function restart() {
    await hub.close();
    active.splice(active.indexOf(hub), 1);
    hub = await start();
    return hub;
  }
  return {
    alpha,
    beta,
    home,
    id,
    origin,
    request,
    login,
    restart,
    get hub() {
      return hub;
    },
  };
}

const encode = (text: string) => Buffer.from(text).toString('base64');

async function ready() {
  const fx = await fixture();
  const login = await fx.login();
  const project = fx.id(fx.alpha);
  const prefix = `/api/remote/projects/${project}`;
  const call = async (suffix: string, body?: unknown, headers = login.headers) => {
    const claiming = /\/(?:claim|recover)$/.test(suffix);
    if (claiming && body)
      body = {
        ...body,
        token:
          (body as { token?: string }).token ??
          crypto
            .createHash('sha256')
            .update(String((body as { requestId: string }).requestId))
            .digest('hex'),
      };
    const response = await fx.request(`${prefix}/feedback/${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json();
    if (claiming && response.status === 200) {
      expect(json.task).not.toHaveProperty('token');
      json.task.token = (body as { token: string }).token; // Test-only execution identity, never supplied by the server.
    }
    return { status: response.status, body: json };
  };
  const put = await fx.request(`${prefix}/artifacts/document/plan`, {
    method: 'PUT',
    headers: { ...login.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseRevision: null,
      files: { 'doc.xml': encode('<doc><p blockId="intro">draft</p></doc>') },
    }),
  });
  expect(put.status).toBe(200);
  const snapshot = await put.json();
  const browser = async (suffix: string, body?: unknown) => {
    const response = await fx.request(`/api/document/plan/feedback/${suffix}?key=${MASTER}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Origin': fx.origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const comment = await fx.request(`/api/document/plan/comments?key=${MASTER}`, {
    method: 'POST',
    headers: { 'Origin': fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'create', blockId: 'intro', quote: 'draft', text: 'Please revise' }),
  });
  expect(comment.status, await comment.clone().text()).toBe(200);
  const connected = await call('connections', {
    host: 'lody',
    session: 'fixture-session',
    displayName: 'Fixture',
    artifacts: ['document/plan'],
    requestId: 'connect',
  });
  expect(connected.status, JSON.stringify(connected.body)).toBe(200);
  const connection = connected.body.connection;
  const input = await browser('input');
  expect(input.status, JSON.stringify(input.body)).toBe(200);
  const submitted = await browser('submit', {
    connectionId: connection.id,
    submissionKey: 'submit',
    selection: input.body.selection,
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  return {
    fx,
    login,
    project,
    prefix,
    call,
    browser,
    connection,
    input: input.body,
    task: submitted.body.task,
    snapshot,
  };
}

test('real hub persists a batch across restart, claims once, returns revision/reply, and accepts only by browser action', async () => {
  const f = await ready();
  await f.fx.restart();
  expect((await f.call('tasks')).body.tasks[0].id).toBe(f.task.id);
  const claimInput = {
    connectionId: f.connection.id,
    generation: f.connection.generation,
    claimant: 'fixture-session',
    requestId: 'claim',
  };
  const claimed = await f.call(`tasks/${f.task.id}/claim`, claimInput);
  expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
  const credential = claimed.body.task;
  expect((await f.call(`tasks/${f.task.id}/claim`, claimInput)).body.task.token).toBe(
    credential.token,
  );
  expect(JSON.stringify((await f.call('tasks')).body)).not.toContain(credential.token);
  const result = {
    ...credential,
    operationId: 'result',
    upload: {
      baseRevision: credential.inputRevision,
      files: { 'doc.xml': encode('<doc><p blockId="intro">revised</p></doc>') },
    },
    replies: [{ threadId: f.input.selection[0].threadId, text: 'Revised intro' }],
  };
  const completed = await f.call(`tasks/${f.task.id}/result`, result);
  expect(completed.status, JSON.stringify(completed.body)).toBe(200);
  expect(completed.body.task.state).toBe('awaiting_review');
  const replay = await f.call(`tasks/${f.task.id}/result`, result);
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  const comments = (await f.browser('input')).body.threads;
  expect(comments[0].messages.filter((m: { author: string }) => m.author === 'agent')).toHaveLength(
    1,
  );
  expect(comments[0].status).toBe('open');
  expect((await f.call(`tasks/${f.task.id}/accept`, credential)).status).toBe(404);
  expect((await f.browser(`tasks/${f.task.id}/accept`, {})).body.task.state).toBe('accepted');
  expect((await f.browser('input')).body.threads[0].status).toBe('open');
});

test('real hub rejects cross-project, browser remote credentials, stale generation and revoked devices', async () => {
  const f = await ready();
  const other = await f.fx.request(
    `/api/remote/projects/${f.fx.id(f.fx.beta)}/feedback/tasks/${f.task.id}`,
    { headers: f.login.headers },
  );
  expect(other.status).toBe(404);
  expect(
    (
      await f.call('tasks', undefined, {
        ...f.login.headers,
        Origin: f.fx.origin,
      } as typeof f.login.headers)
    ).status,
  ).toBe(401);
  const claimed = await f.call(`tasks/${f.task.id}/claim`, {
    connectionId: f.connection.id,
    generation: 1,
    claimant: 'fixture-session',
    requestId: 'claim',
  });
  expect(claimed.status).toBe(200);
  expect((await f.browser(`connections/${f.connection.id}/pause`, {})).status).toBe(200);
  expect((await f.browser(`connections/${f.connection.id}/resume`, {})).status).toBe(200);
  expect((await f.call(`tasks/${f.task.id}/renew`, claimed.body.task)).status).toBe(200);
  const revoke = await f.fx.request('/api/remote/auth/session', {
    method: 'DELETE',
    headers: f.login.headers,
  });
  expect(revoke.status).toBe(200);
  expect((await f.call('tasks')).status).toBe(401);
  expect(
    (
      await f.browser('submit', {
        connectionId: f.connection.id,
        submissionKey: 'later',
        selection: f.input.selection,
      })
    ).body.code,
  ).toBe('connection_unauthorized');
});

test('real CLI uses isolated credentials, prints safe pending, stores claims privately and returns nonzero on rejection', async () => {
  const f = await ready();
  const local = path.join(f.fx.home, 'cli-project');
  fs.mkdirSync(local);
  const client = path.join(f.fx.home, 'client');
  fs.mkdirSync(client);
  const config = {
    servers: {
      [f.fx.origin]: {
        token: f.login.token,
        deviceId: 'fixture',
        deviceName: 'Fixture',
        expiresAt: Date.now() + 60_000,
      },
    },
    bindings: { [local]: { origin: f.fx.origin, projectId: f.project, revisions: {} } },
  };
  fs.writeFileSync(path.join(client, 'connections.json'), JSON.stringify(config), { mode: 0o600 });
  const run = (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        path.resolve('dist/cli.cjs'),
        'remote',
        'feedback',
        ...args,
        '--project-dir',
        local,
        '--json',
      ],
      {
        env: {
          ...process.env,
          ANJIAN_CLIENT_HOME: client,
          ANJIAN_NO_UPDATE_CHECK: '1',
          ANJIAN_CLOUD_ORIGIN: 'http://127.0.0.1:9',
          XDG_CONFIG_HOME: path.join(f.fx.home, 'xdg'),
          ANJIAN_RUNTIME_DIR: path.join(f.fx.home, 'runtime'),
        },
      },
    );
  const pending = await run(['pending']);
  expect(pending.stdout).toContain(f.task.id);
  expect(pending.stdout).not.toContain(f.login.token);
  const manifest = path.join(f.fx.home, 'claim.json');
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      connectionId: f.connection.id,
      generation: 1,
      claimant: 'fixture-session',
      requestId: 'cli-claim',
    }),
  );
  const credential = path.join(f.fx.home, 'claim-private.json');
  const unsafe = path.join(f.fx.home, 'unsafe-claim.json');
  fs.symlinkSync('/dev/null', unsafe);
  await expect(
    run(['claim', '--task', f.task.id, '--input', manifest, '--claim-file', unsafe]),
  ).rejects.toMatchObject({ code: 1 });
  expect((await f.call(`tasks/${f.task.id}`)).body.task.state).toBe('queued');
  // Drop the first claim response only after the real Hub has committed it.
  const end = http.ServerResponse.prototype.end;
  let dropped = false;
  const disconnect = vi.spyOn(http.ServerResponse.prototype, 'end').mockImplementation(function (
    this: http.ServerResponse,
    ...args: Parameters<typeof end>
  ) {
    const data = args[0];
    if (!dropped && typeof data === 'string') {
      try {
        const response = JSON.parse(data);
        if (response.task?.state === 'running' && response.task?.id === f.task.id) {
          expect(fs.existsSync(credential)).toBe(true);
          const saved = JSON.parse(fs.readFileSync(credential, 'utf8'));
          expect(saved.token).toMatch(/^[a-f0-9]{64}$/);
          expect(saved.requestId).toBeTruthy();
          dropped = true;
          this.destroy();
          return this;
        }
      } catch {
        /* Non-JSON response. */
      }
    }
    return end.apply(this, args);
  });
  await expect(
    run(['claim', '--task', f.task.id, '--input', manifest, '--claim-file', credential]),
  ).rejects.toMatchObject({ code: 1 });
  disconnect.mockRestore();
  expect(dropped).toBe(true);
  const committed = (await f.call(`tasks/${f.task.id}`)).body.task;
  const savedBeforeRetry = JSON.parse(fs.readFileSync(credential, 'utf8'));
  const claimed = await run([
    'claim',
    '--task',
    f.task.id,
    '--input',
    manifest,
    '--claim-file',
    credential,
  ]);
  const retried = JSON.parse(claimed.stdout.trim()).task;
  expect(retried.attempt).toBe(committed.attempt);
  expect(retried.leaseUntil).toBe(committed.leaseUntil);
  expect(JSON.parse(fs.readFileSync(credential, 'utf8')).requestId).toBe(
    savedBeforeRetry.requestId,
  );
  const secret = JSON.parse(fs.readFileSync(credential, 'utf8'));
  expect(secret.token).toMatch(/^[a-f0-9]{64}$/);
  expect(claimed.stdout).not.toContain(secret.token);
  expect(
    fs.readFileSync(path.join(f.fx.home, 'feedback', `${f.project}.json`), 'utf8'),
  ).not.toContain(secret.token);
  expect(fs.statSync(credential).mode & 0o077).toBe(0);
  const replay = await run([
    'claim',
    '--task',
    f.task.id,
    '--input',
    manifest,
    '--claim-file',
    credential,
  ]);
  expect(replay.stdout).not.toContain(secret.token);
  expect(JSON.parse(fs.readFileSync(credential, 'utf8')).token).toBe(secret.token);
  expect((await run(['pending'])).stdout).not.toContain(secret.token);
  await f.fx.request('/api/remote/auth/session', { method: 'DELETE', headers: f.login.headers });
  await expect(run(['pending'])).rejects.toMatchObject({ code: 1 });
});

test.each(['uploaded', 'replied', 'complete'])(
  'result resumes after persistence fails at %s without duplicate upload or reply',
  async (stage) => {
    const f = await ready();
    const claimed = await f.call(`tasks/${f.task.id}/claim`, {
      connectionId: f.connection.id,
      generation: 1,
      claimant: 'fixture-session',
      requestId: 'claim',
    });
    const result = {
      ...claimed.body.task,
      operationId: 'interrupted',
      upload: {
        baseRevision: claimed.body.task.inputRevision,
        files: { 'doc.xml': encode('<doc><p blockId="intro">after crash</p></doc>') },
      },
      replies: [{ threadId: f.input.selection[0].threadId, text: 'Changed once' }],
    };
    const rename = fs.renameSync;
    let injected = false;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (
        !injected &&
        String(destination) === path.join(f.fx.home, 'feedback', `${f.project}.json`)
      ) {
        const data = JSON.parse(fs.readFileSync(source, 'utf8'));
        if (data.tasks[0].operation?.stage === stage) {
          injected = true;
          throw new Error('simulated persistence interruption');
        }
      }
      return rename(source, destination);
    });
    expect((await f.call(`tasks/${f.task.id}/result`, result)).status).toBe(500);
    expect(injected).toBe(true);
    fault.mockRestore();
    await f.fx.restart();
    const resumed = await f.call(`tasks/${f.task.id}/result`, result);
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body.task.state).toBe('awaiting_review');
    const comments = (await f.browser('input')).body.threads;
    expect(
      comments[0].messages.filter((m: { author: string }) => m.author === 'agent'),
    ).toHaveLength(1);
    expect(
      (
        await f.call(`tasks/${f.task.id}/result`, {
          ...result,
          replies: [{ ...result.replies[0], text: 'Different' }],
        })
      ).body.code,
    ).toBe('idempotency_conflict');
  },
);

test('new browser feedback during execution queues separately and cannot accept running work', async () => {
  const f = await ready();
  const claimed = await f.call(`tasks/${f.task.id}/claim`, {
    connectionId: f.connection.id,
    generation: 1,
    claimant: 'fixture-session',
    requestId: 'claim',
  });
  expect(claimed.status).toBe(200);
  const reply = await f.fx.request(`/api/document/plan/comments?key=${MASTER}`, {
    method: 'POST',
    headers: { 'Origin': f.fx.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      op: 'reply',
      threadId: f.input.selection[0].threadId,
      text: 'Another requirement',
    }),
  });
  expect(reply.status).toBe(200);
  const input = (await f.browser('input')).body;
  const second = await f.browser('submit', {
    connectionId: f.connection.id,
    submissionKey: 'next',
    selection: input.selection,
  });
  expect(second.status).toBe(200);
  expect(second.body.task.state).toBe('queued');
  expect(second.body.task.threads[0].messages).toHaveLength(2);
  expect((await f.call(`tasks/${f.task.id}`)).body.task.threads[0].messages).toHaveLength(1);
  expect(
    (
      await f.call(`tasks/${second.body.task.id}/claim`, {
        connectionId: f.connection.id,
        generation: 1,
        claimant: 'fixture-session',
        requestId: 'claim-next',
      })
    ).body.code,
  ).toBe('artifact_busy');
  expect((await f.browser(`tasks/${f.task.id}/accept`, {})).status).toBe(409);
  expect((await f.browser(`tasks/${f.task.id}/retry`, {})).status).toBe(409);
  expect(
    (
      await f.call(`tasks/${f.task.id}/fail`, {
        ...claimed.body.task,
        errorCode: 'host_interrupted',
      })
    ).status,
  ).toBe(200);
  expect((await f.browser(`tasks/${f.task.id}/retry`, {})).body.task.state).toBe('needs_attention');
});

test('revocation during result preparation is rechecked before installing source bytes', async () => {
  const f = await ready();
  const claimed = await f.call(`tasks/${f.task.id}/claim`, {
    connectionId: f.connection.id,
    generation: 1,
    claimant: 'fixture-session',
    requestId: 'claim',
  });
  const before = fs.readFileSync(
    path.join(f.fx.alpha, '.anjian/artifacts/document/plan/doc.xml'),
    'utf8',
  );
  const stat = fs.promises.lstat;
  let revoked = false;
  const fault = vi
    .spyOn(fs.promises, 'lstat')
    .mockImplementation(async (...args: Parameters<typeof stat>) => {
      const state = JSON.parse(
        fs.readFileSync(path.join(f.fx.home, 'feedback', `${f.project}.json`), 'utf8'),
      );
      if (!revoked && state.tasks[0].operation?.stage === 'prepared') {
        revoked = true;
        expect(
          (
            await f.fx.request('/api/remote/auth/session', {
              method: 'DELETE',
              headers: f.login.headers,
            })
          ).status,
        ).toBe(200);
      }
      return stat(...args);
    });
  const result = await f.call(`tasks/${f.task.id}/result`, {
    ...claimed.body.task,
    operationId: 'revoked',
    upload: {
      baseRevision: claimed.body.task.inputRevision,
      files: { 'doc.xml': encode('<doc><p blockId="intro">must not install</p></doc>') },
    },
    replies: [{ threadId: f.input.selection[0].threadId, text: 'Not applied' }],
  });
  fault.mockRestore();
  expect(revoked).toBe(true);
  expect(result.status).toBe(401);
  expect(
    fs.readFileSync(path.join(f.fx.alpha, '.anjian/artifacts/document/plan/doc.xml'), 'utf8'),
  ).toBe(before);
});

test('feedback metadata is charged to storage quotas and oversized HTTP metadata is rejected', async () => {
  const f = await ready();
  const usage = createStorageUsage({
    projects: () => [{ dir: f.fx.alpha, owner: 'owner' }],
    snapshotsRoot: path.join(f.fx.home, 'shares/snapshots'),
    snapshots: () => [],
    metadataRoot: path.join(f.fx.home, 'feedback'),
    metadataOwner: () => 'owner',
  });
  const report = await usage.read('shared');
  expect(report.history).toBeGreaterThanOrEqual(
    fs.statSync(path.join(f.fx.home, 'feedback', `${f.project}.json`)).size,
  );
  expect((await f.call('connections', { padding: 'x'.repeat(256 * 1024) })).status).toBe(413);
  createStorageSettings(f.fx.home).setSharedLimit(0);
  const before = fs.readFileSync(path.join(f.fx.home, 'feedback', `${f.project}.json`), 'utf8');
  expect(
    (
      await f.browser('submit', {
        connectionId: f.connection.id,
        submissionKey: 'quota-denied',
        selection: f.input.selection,
      })
    ).body.code,
  ).toBe('storage_quota_exceeded');
  expect(fs.readFileSync(path.join(f.fx.home, 'feedback', `${f.project}.json`), 'utf8')).toBe(
    before,
  );
  createStorageSettings(f.fx.home).setSharedLimit(1024 * 1024 * 1024);
});

test('artboard task uploads pages and replies to the original thread without resolving it', async () => {
  const fx = await fixture();
  const login = await fx.login();
  const project = fx.id(fx.alpha);
  const files = {
    'canvas.json': encode(
      JSON.stringify({
        version: 1,
        pages: [{ id: 'main', name: 'Main' }],
        boards: {
          demo: { page: 'main', file: 'pages/main/demo.html', x: 0, y: 0, w: 640, h: 400 },
        },
      }),
    ),
    'pages/main/demo.html': encode('<html><body>before</body></html>'),
  };
  const request = async (route: string, body?: unknown, browser = false, method = 'POST') => {
    const claiming = /\/(?:claim|recover)$/.test(route);
    if (claiming && body) body = { ...body, token: 'b'.repeat(64) };
    const response = await fx.request(route + (browser ? `?key=${MASTER}` : ''), {
      method: body === undefined ? 'GET' : method,
      headers: {
        ...(browser ? { Origin: fx.origin } : login.headers),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(200);
    if (claiming) {
      expect(json.task).not.toHaveProperty('token');
      json.task.token = 'b'.repeat(64);
    }
    return json;
  };
  const base = `/api/remote/projects/${project}/feedback`;
  await request(
    `/api/remote/projects/${project}/artifacts/artboard/demo`,
    { baseRevision: null, files },
    false,
    'PUT',
  );
  await request(
    '/api/artboard/demo/comments',
    { op: 'create', anchor: { page: 'main', board: 'demo', x: 10, y: 10 }, text: 'Change page' },
    true,
  );
  const connection = (
    await request(`${base}/connections`, {
      host: 'lody',
      session: 'session',
      displayName: 'Board',
      artifacts: ['artboard/demo'],
      requestId: 'connect',
    })
  ).connection;
  const input = await request('/api/artboard/demo/feedback/input', undefined, true);
  const task = (
    await request(
      '/api/artboard/demo/feedback/submit',
      { connectionId: connection.id, submissionKey: 'submit', selection: input.selection },
      true,
    )
  ).task;
  const claim = (
    await request(`${base}/tasks/${task.id}/claim`, {
      connectionId: connection.id,
      generation: 1,
      claimant: 'session',
      requestId: 'claim',
    })
  ).task;
  const result = await request(`${base}/tasks/${task.id}/result`, {
    ...claim,
    operationId: 'result',
    upload: {
      baseRevision: claim.inputRevision,
      files: { ...files, 'pages/main/demo.html': encode('<html><body>after</body></html>') },
    },
    replies: [{ threadId: input.selection[0].threadId, text: 'Page changed' }],
  });
  expect(result.task.state).toBe('awaiting_review');
  const comments = (await request('/api/artboard/demo/feedback/input', undefined, true)).threads;
  expect(comments[0].messages).toHaveLength(2);
  expect(comments[0].status).toBe('open');
});

test('explicit same-device rebind preserves the task and fences the previous session and claim', async () => {
  const f = await ready();
  const first = (
    await f.call(`tasks/${f.task.id}/claim`, {
      connectionId: f.connection.id,
      generation: 1,
      claimant: 'fixture-session',
      requestId: 'first',
    })
  ).body.task;
  const binding = {
    generation: 1,
    session: 'replacement-session',
    displayName: 'Replacement',
    requestId: 'rebind',
  };
  const rebound = await f.call(`connections/${f.connection.id}/rebind`, binding);
  expect(rebound.status).toBe(200);
  expect(rebound.body.connection.generation).toBe(2);
  expect(
    (await f.call(`connections/${f.connection.id}/rebind`, binding)).body.connection.generation,
  ).toBe(2);
  expect((await f.call(`tasks/${f.task.id}/renew`, first)).body.code).toBe('stale_claim');
  expect(
    (
      await f.call(`tasks/${f.task.id}/recover`, {
        connectionId: f.connection.id,
        generation: 2,
        claimant: 'fixture-session',
        requestId: 'old-session',
      })
    ).body.code,
  ).toBe('session_mismatch');
  const retry = (await f.browser(`tasks/${f.task.id}/retry`, {})).body.task;
  const recovered = await f.call(`tasks/${f.task.id}/recover`, {
    connectionId: f.connection.id,
    generation: 2,
    claimant: 'replacement-session',
    requestId: 'recovered',
    recoveryRequestSeq: retry.recoveryRequestSeq,
  });
  expect(recovered.status).toBe(200);
  expect(recovered.body.task.attempt).toBe(2);
});

test('browser GET works without Origin while cross-origin reads and writes without Origin are rejected', async () => {
  const f = await ready();
  const route = `/api/document/plan/feedback/input?key=${MASTER}`;
  const read = await f.fx.request(route, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  expect(read.status).toBe(200);
  const cross = await f.fx.request(route, {
    headers: { 'Origin': 'https://foreign.invalid', 'Sec-Fetch-Site': 'cross-site' },
  });
  expect(cross.status).toBe(404);
  const post = await f.fx.request(`/api/document/plan/feedback/submit?key=${MASTER}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: f.connection.id,
      submissionKey: 'no-origin',
      selection: f.input.selection,
    }),
  });
  expect(post.status).toBe(404);
});

test('pause keeps current result writable, blocks new claims, and resume preserves generation', async () => {
  const f = await ready();
  const request = {
    connectionId: f.connection.id,
    generation: 1,
    claimant: 'fixture-session',
    requestId: 'pause-claim',
  };
  const claimed = (await f.call(`tasks/${f.task.id}/claim`, request)).body.task;
  const second = (
    await f.browser('submit', {
      connectionId: f.connection.id,
      submissionKey: 'second',
      selection: f.input.selection,
    })
  ).body.task;
  expect(
    (await f.browser(`connections/${f.connection.id}/pause`, {})).body.connection.generation,
  ).toBe(1);
  expect(
    (await f.call(`tasks/${second.id}/claim`, { ...request, requestId: 'blocked' })).body.code,
  ).toBe('connection_unavailable');
  const replay = await f.call(`tasks/${f.task.id}/claim`, request);
  expect(replay.body.task.attempt).toBe(claimed.attempt);
  expect(replay.body.task.leaseUntil).toBe(claimed.leaseUntil);
  expect(
    (await f.call(`tasks/${f.task.id}/claim`, { ...request, token: 'f'.repeat(64) })).body.code,
  ).toBe('idempotency_conflict');
  const result = await f.call(`tasks/${f.task.id}/result`, {
    ...claimed,
    operationId: 'paused-result',
    upload: {
      baseRevision: claimed.inputRevision,
      files: { 'doc.xml': encode('<doc><p blockId="intro">done while paused</p></doc>') },
    },
    replies: [{ threadId: f.input.selection[0].threadId, text: 'Done' }],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.task.state).toBe('awaiting_review');
  expect(
    (await f.browser(`connections/${f.connection.id}/resume`, {})).body.connection.generation,
  ).toBe(1);
}, 10000);

test.each(['cancel', 'rebind'])(
  '%s rejects the old result without changing source',
  async (action) => {
    const f = await ready();
    const claimed = (
      await f.call(`tasks/${f.task.id}/claim`, {
        connectionId: f.connection.id,
        generation: 1,
        claimant: 'fixture-session',
        requestId: 'claim',
      })
    ).body.task;
    if (action === 'cancel')
      expect((await f.browser(`tasks/${f.task.id}/cancel`, {})).status).toBe(200);
    else
      expect(
        (
          await f.call(`connections/${f.connection.id}/rebind`, {
            generation: 1,
            session: 'replacement',
            displayName: 'Replacement',
            requestId: 'rebind',
          })
        ).status,
      ).toBe(200);
    const result = await f.call(`tasks/${f.task.id}/result`, {
      ...claimed,
      operationId: 'stale',
      upload: {
        baseRevision: claimed.inputRevision,
        files: { 'doc.xml': encode('<doc><p blockId="intro">stale</p></doc>') },
      },
      replies: [{ threadId: f.input.selection[0].threadId, text: 'Stale' }],
    });
    expect(result.body.code).toBe('stale_claim');
    expect((await f.browser('input')).body.revision).toBe(claimed.inputRevision);
  },
);

test('explicit rebind can transfer to another project-authorized device and fences the former device', async () => {
  const f = await ready();
  const original = (
    await f.call(`tasks/${f.task.id}/claim`, {
      connectionId: f.connection.id,
      generation: 1,
      claimant: 'fixture-session',
      requestId: 'original',
    })
  ).body.task;
  const replacement = await f.fx.login();
  const rebound = await f.call(
    `connections/${f.connection.id}/rebind`,
    {
      generation: 1,
      session: 'new-device-session',
      displayName: 'New device',
      requestId: 'transfer',
    },
    replacement.headers,
  );
  expect(rebound.status).toBe(200);
  expect((await f.call(`tasks/${f.task.id}/renew`, original)).status).toBe(404);
  const retry = (await f.browser(`tasks/${f.task.id}/retry`, {})).body.task;
  expect(
    (
      await f.call(
        `tasks/${f.task.id}/recover`,
        {
          connectionId: f.connection.id,
          generation: 2,
          claimant: 'new-device-session',
          requestId: 'new-device-recover',
          recoveryRequestSeq: retry.recoveryRequestSeq,
        },
        replacement.headers,
      )
    ).status,
  ).toBe(200);
});

test('public generated and legacy locators resolve feedback to the real artifact with ordinary GET authentication', async () => {
  const f = await ready();
  const paths = [new URL(f.snapshot.url).pathname, '/document/Ab_Cd-EfGhIjKlMnOpQrs'];
  for (const [index, page] of paths.entries()) {
    if (index) {
      fs.writeFileSync(
        path.join(f.fx.alpha, '.anjian/artifacts/document/plan/.artifact-id'),
        page.split('/').at(-1)!,
      );
      await f.fx.restart();
    }
    const response = await f.fx.request(`/api${page}/feedback/input?key=${MASTER}`, {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).artifact).toBe('document/plan');
    const denied = await f.fx.request(`/api${page}/feedback/input`, {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(denied.status).toBe(404);
  }
});

test('pending exposes cross-device occupancy without disclosing the blocking task', async () => {
  const f = await ready();
  const first = (
    await f.call(`tasks/${f.task.id}/claim`, {
      connectionId: f.connection.id,
      generation: 1,
      claimant: 'fixture-session',
      requestId: 'first',
    })
  ).body.task;
  await f.call(`tasks/${f.task.id}/fail`, { ...first, errorCode: 'host_failed' });
  await f.browser(`connections/${f.connection.id}/pause`, {});
  const secondDevice = await f.fx.login();
  const connection = (
    await f.call(
      'connections',
      {
        host: 'lody',
        session: 'second-session',
        displayName: 'Second',
        artifacts: ['document/plan'],
        requestId: 'second-connect',
      },
      secondDevice.headers,
    )
  ).body.connection;
  const second = (
    await f.browser('submit', {
      connectionId: connection.id,
      submissionKey: 'second',
      selection: f.input.selection,
    })
  ).body.task;
  const pending = await f.call('tasks', undefined, secondDevice.headers);
  expect(pending.body.tasks).toHaveLength(1);
  expect(pending.body.tasks[0]).toMatchObject({
    id: second.id,
    claimable: false,
    recoverable: false,
    blockedReason: 'artifact_busy',
  });
  expect(JSON.stringify(pending.body)).not.toContain(f.task.id);
  expect(JSON.stringify(pending.body)).not.toContain(f.connection.id);
  expect(
    (
      await f.call(
        `tasks/${second.id}/claim`,
        {
          connectionId: connection.id,
          generation: 1,
          claimant: 'second-session',
          requestId: 'second-claim',
        },
        secondDevice.headers,
      )
    ).body.code,
  ).toBe('artifact_busy');
  await f.browser(`tasks/${f.task.id}/cancel`, {});
  expect((await f.call('tasks', undefined, secondDevice.headers)).body.tasks[0].claimable).toBe(
    true,
  );
  await f.browser(`connections/${connection.id}/pause`, {});
  expect((await f.call('tasks', undefined, secondDevice.headers)).body.tasks[0]).toMatchObject({
    claimable: false,
    blockedReason: 'connection_unavailable',
  });
});

test('one explicit retry authorizes one recovery, persists consumption, and failure cannot recover again automatically', async () => {
  const f = await ready();
  const base = { connectionId: f.connection.id, generation: 1, claimant: 'fixture-session' };
  const first = (await f.call(`tasks/${f.task.id}/claim`, { ...base, requestId: 'first' })).body
    .task;
  await f.call(`tasks/${f.task.id}/fail`, { ...first, errorCode: 'host_failed' });
  expect((await f.call(`tasks/${f.task.id}`)).body.task).toMatchObject({
    recoverable: false,
    recoveryRequestSeq: 0,
    recoveryConsumedSeq: 0,
    blockedReason: 'recovery_not_requested',
  });
  expect(
    (
      await f.call(`tasks/${f.task.id}/recover`, {
        ...base,
        requestId: 'unsolicited',
        recoveryRequestSeq: 0,
      })
    ).body.code,
  ).toBe('recovery_not_requested');
  const requested = (await f.browser(`tasks/${f.task.id}/retry`, {})).body.task;
  expect(requested).toMatchObject({
    recoveryRequestSeq: 1,
    recoveryConsumedSeq: 0,
    recoverable: true,
  });
  expect((await f.browser(`tasks/${f.task.id}/retry`, {})).body.task.recoveryRequestSeq).toBe(1);
  await f.fx.restart();
  const input = { ...base, requestId: 'recover-once', recoveryRequestSeq: 1 };
  const recovered = (await f.call(`tasks/${f.task.id}/recover`, input)).body.task;
  expect(recovered).toMatchObject({ attempt: 2, recoveryConsumedSeq: 1, recoverable: false });
  const replay = (await f.call(`tasks/${f.task.id}/recover`, input)).body.task;
  expect(replay.attempt).toBe(2);
  expect(replay.leaseUntil).toBe(recovered.leaseUntil);
  await f.call(`tasks/${f.task.id}/fail`, { ...recovered, errorCode: 'failed_again' });
  await f.fx.restart();
  expect((await f.call(`tasks/${f.task.id}`)).body.task).toMatchObject({
    recoveryRequestSeq: 1,
    recoveryConsumedSeq: 1,
    recoverable: false,
  });
  expect(
    (
      await f.call(`tasks/${f.task.id}/recover`, {
        ...base,
        requestId: 'loop',
        recoveryRequestSeq: 1,
      })
    ).body.code,
  ).toBe('recovery_not_requested');
  expect((await f.call(`tasks/${f.task.id}/recover`, input)).body.task.attempt).toBe(2);
  expect((await f.browser(`tasks/${f.task.id}/retry`, {})).body.task.recoveryRequestSeq).toBe(2);
  expect(
    (
      await f.call(`tasks/${f.task.id}/recover`, {
        ...base,
        requestId: 'stale',
        recoveryRequestSeq: 1,
      })
    ).body.code,
  ).toBe('stale_recovery_request');
  expect(
    (
      await f.call(`tasks/${f.task.id}/recover`, {
        ...base,
        requestId: 'fresh',
        recoveryRequestSeq: 2,
      })
    ).body.task.attempt,
  ).toBe(3);
});

async function roundFixture() {
  const fx = await fixture();
  const login = await fx.login();
  const project = fx.id(fx.alpha);
  const canvas = {
    version: 1,
    pages: [{ id: 'main', name: 'Main' }],
    boards: {
      a: { page: 'main', file: 'pages/main/a.html', x: 0, y: 100, w: 640, h: 400 },
      b: { page: 'main', file: 'pages/main/b.html', x: 700, y: 100, w: 640, h: 400 },
    },
    notes: {
      alternatives: { page: 'main', kind: 'title', x: 0, y: -400, text: 'First alternatives' },
    },
    groups: { options: { boards: ['a', 'b'], choose: true, recommend: 'b', title: 'Direction' } },
  };
  const files = {
    'canvas.json': encode(JSON.stringify(canvas)),
    'pages/main/a.html': encode('<html><body>A</body></html>'),
    'pages/main/b.html': encode('<html><body>B</body></html>'),
  };
  const remote = `/api/remote/projects/${project}`;
  const request = async (route: string, body?: unknown, browser = false, method = 'POST') => {
    const response = await fx.request(route + (browser ? `?key=${MASTER}` : ''), {
      method: body === undefined ? 'GET' : method,
      headers: {
        ...(browser ? { Origin: fx.origin } : login.headers),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  expect(
    (
      await request(
        `${remote}/artifacts/artboard/demo`,
        { baseRevision: null, files },
        false,
        'PUT',
      )
    ).status,
  ).toBe(200);
  const connection = (
    await request(`${remote}/feedback/connections`, {
      host: 'lody',
      session: 'round-session',
      displayName: 'Round',
      artifacts: ['artboard/demo'],
      requestId: 'connect',
    })
  ).body.connection;
  const input = async () => {
    const result = await request('/api/artboard/demo/feedback/input', undefined, true);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  };
  const submit = (body: unknown) => request('/api/artboard/demo/feedback/submit', body, true);
  const comment = (body: unknown) => request('/api/artboard/demo/comments', body, true);
  return {
    fx,
    remote,
    files,
    connection,
    request,
    input,
    submit,
    comment,
    commentsFile: path.join(fx.alpha, '.anjian/artifacts/artboard/demo/comments.json'),
  };
}

test('round snapshot captures choices, recommendations and related ordinary comments without a legacy submit marker', async () => {
  const f = await roundFixture();
  const recommended = await f.input();
  expect(recommended.rounds[0].groups[0]).toMatchObject({
    choice: 'b',
    byRecommendation: true,
    recommend: 'b',
  });
  expect(
    (
      await f.comment({
        op: 'create',
        anchor: { page: 'main', x: 0, y: 0, group: 'options', choice: 'a' },
        text: 'a',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.comment({
        op: 'create',
        anchor: { page: 'main', x: 20, y: 20, board: 'a' },
        text: 'Adjust selected spacing',
      })
    ).status,
  ).toBe(200);
  const input = await f.input();
  const round = input.rounds[0];
  expect(round.groups[0]).toMatchObject({ choice: 'a', byRecommendation: false, by: 'human' });
  expect(round.threadCount).toBe(1);
  expect(round.title).toBe('First alternatives');
  const before = fs.readFileSync(f.commentsFile, 'utf8');
  const submitted = await f.submit({
    connectionId: f.connection.id,
    submissionKey: 'round-first',
    round: { id: round.id, version: round.version },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  expect(submitted.body.task.roundId).toBe(round.id);
  expect(submitted.body.task.roundContext.title).toBe('First alternatives');
  expect(submitted.body.task.threads).toHaveLength(1);
  expect(submitted.body.task.roundContext.choiceRecords).toHaveLength(1);
  expect(submitted.body.task.roundContext.canvas.groups.options.recommend).toBe('b');
  expect(submitted.body.task.roundContext.groups[0].threadIds).toEqual([
    submitted.body.task.threads[0].id,
  ]);
  expect(fs.readFileSync(f.commentsFile, 'utf8')).toBe(before);
  expect((await f.input()).rounds[0].state).toBe('submitted');
  const list = await f.request(`${f.remote}/feedback/tasks`);
  expect(list.body.tasks[0].roundId).toBe(round.id);
  expect(list.body.tasks[0]).not.toHaveProperty('roundContext');
});

test('zero-comment recommendation round accepts an empty reply list and leaves comments absent', async () => {
  const f = await roundFixture();
  const input = await f.input();
  const round = input.rounds[0];
  const submitted = await f.submit({
    connectionId: f.connection.id,
    submissionKey: 'zero',
    round: { id: round.id, version: round.version },
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const task = submitted.body.task;
  expect(task.threads).toEqual([]);
  expect(task.roundContext.groups[0].byRecommendation).toBe(true);
  expect(fs.existsSync(f.commentsFile)).toBe(false);
  const claimed = await f.request(`${f.remote}/feedback/tasks/${task.id}/claim`, {
    connectionId: f.connection.id,
    generation: 1,
    claimant: 'round-session',
    requestId: 'claim',
    token: 'a'.repeat(64),
  });
  expect(claimed.status).toBe(200);
  const result = await f.request(`${f.remote}/feedback/tasks/${task.id}/result`, {
    ...claimed.body.task,
    token: 'a'.repeat(64),
    operationId: 'result',
    upload: {
      baseRevision: claimed.body.task.inputRevision,
      files: {
        ...f.files,
        'pages/main/b.html': encode('<html><body>Updated recommended B</body></html>'),
      },
    },
    replies: [],
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.task.state).toBe('awaiting_review');
  expect(fs.existsSync(f.commentsFile)).toBe(false);
});

test('round submission replays after changed input, rejects a second key, and permits a fresh submission after cancel', async () => {
  const f = await roundFixture();
  const input = await f.input();
  const round = input.rounds[0];
  const body = {
    connectionId: f.connection.id,
    submissionKey: 'stable',
    round: { id: round.id, version: round.version },
  };
  const first = await f.submit(body);
  expect(first.status).toBe(200);
  await f.comment({
    op: 'create',
    anchor: { page: 'main', x: 0, y: 0, group: 'options', choice: 'a' },
    text: 'a',
  });
  await f.fx.restart();
  expect((await f.submit(body)).body.task.id).toBe(first.body.task.id);
  expect((await f.submit({ ...body, submissionKey: 'duplicate' })).body.code).toBe(
    'round_already_submitted',
  );
  expect((await f.submit({ ...body, selection: [] })).body.code).toBe('invalid_submission');
  expect(
    (await f.request(`/api/artboard/demo/feedback/tasks/${first.body.task.id}/cancel`, {}, true))
      .status,
  ).toBe(200);
  expect((await f.submit({ ...body, submissionKey: 'stale-after-cancel' })).body.code).toBe(
    'feedback_changed',
  );
  const current = (await f.input()).rounds[0];
  expect(current.state).toBe('open');
  const next = await f.submit({
    ...body,
    submissionKey: 'new-after-cancel',
    round: { id: current.id, version: current.version },
  });
  expect(next.status).toBe(200);
  expect(next.body.task.id).not.toBe(first.body.task.id);
});

test('round version includes new related comments and canvas recommendations; paused rounds queue without fallback', async () => {
  const f = await roundFixture();
  const round = (await f.input()).rounds[0];
  await f.comment({
    op: 'create',
    anchor: { page: 'main', x: 10, y: 10, board: 'a' },
    text: 'New concern',
  });
  expect(
    (
      await f.submit({
        connectionId: f.connection.id,
        submissionKey: 'old',
        round: { id: round.id, version: round.version },
      })
    ).body.code,
  ).toBe('feedback_changed');
  const afterComment = (await f.input()).rounds[0];
  const source = path.join(f.fx.alpha, '.anjian/artifacts/artboard/demo/canvas.json');
  const canvas = JSON.parse(fs.readFileSync(source, 'utf8'));
  canvas.groups.options.recommend = 'a';
  fs.writeFileSync(source, JSON.stringify(canvas));
  expect(
    (
      await f.submit({
        connectionId: f.connection.id,
        submissionKey: 'old-canvas',
        round: { id: afterComment.id, version: afterComment.version },
      })
    ).body.code,
  ).toBe('feedback_changed');
  await f.request(`/api/artboard/demo/feedback/connections/${f.connection.id}/pause`, {}, true);
  const current = (await f.input()).rounds[0];
  const before = fs.readFileSync(f.commentsFile, 'utf8');
  const queued = await f.submit({
    connectionId: f.connection.id,
    submissionKey: 'paused',
    round: { id: current.id, version: current.version },
  });
  expect(queued.status).toBe(200);
  expect(queued.body.task.claimable).toBe(false);
  expect(fs.readFileSync(f.commentsFile, 'utf8')).toBe(before);
  expect((await f.request('/api/remote/auth/session', {}, false, 'DELETE')).status).toBe(200);
  expect(
    (
      await f.submit({
        connectionId: f.connection.id,
        submissionKey: 'revoked',
        round: { id: current.id, version: current.version },
      })
    ).body.code,
  ).toBe('connection_unauthorized');
  expect(fs.readFileSync(f.commentsFile, 'utf8')).toBe(before);
});

test('a round committed before a dropped HTTP response replays the original intent after inputs change', async () => {
  const f = await roundFixture();
  const round = (await f.input()).rounds[0];
  const body = {
    connectionId: f.connection.id,
    submissionKey: 'lost-response',
    round: { id: round.id, version: round.version },
  };
  const end = http.ServerResponse.prototype.end;
  let dropped = false;
  const disconnect = vi.spyOn(http.ServerResponse.prototype, 'end').mockImplementation(function (
    this: http.ServerResponse,
    ...args: Parameters<typeof end>
  ) {
    if (!dropped && typeof args[0] === 'string') {
      let response;
      try {
        response = JSON.parse(args[0]);
      } catch {
        /* Not JSON. */
      }
      if (response?.task?.roundId === round.id) {
        dropped = true;
        this.destroy();
        return this;
      }
    }
    return end.apply(this, args);
  });
  await expect(f.submit(body)).rejects.toThrow();
  disconnect.mockRestore();
  expect(dropped).toBe(true);
  const before = (await f.request(`${f.remote}/feedback/tasks`)).body.tasks;
  expect(before).toHaveLength(1);
  await f.comment({
    op: 'create',
    anchor: { page: 'main', x: 0, y: 0, group: 'options', choice: 'a' },
    text: 'a',
  });
  const retry = await f.submit(body);
  expect(retry.status).toBe(200);
  expect(retry.body.task.id).toBe(before[0].id);
  expect((await f.request(`${f.remote}/feedback/tasks`)).body.tasks).toHaveLength(1);
  expect(retry.body.task.roundContext.groups[0].choice).toBe('b');
});
