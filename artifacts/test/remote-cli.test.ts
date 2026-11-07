import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { remoteCommands } from '../src/cli/remote-commands';
import { applyLocalFiles, backupHome, clientHome, filesHash, localFiles, readConfig, sleep, updateConfig, withArtifactLock } from '../src/cli/remote-core';
import { serverClient } from '../src/cli/server';

let home: string;
let project: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.ANJIAN_CLIENT_HOME;
  home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'anjian-remote-cli-'));
  process.env.ANJIAN_CLIENT_HOME = path.join(home, 'state');
  project = path.join(home, 'project');
  fs.mkdirSync(project);
});
afterEach(() => {
  if (previous === undefined) delete process.env.ANJIAN_CLIENT_HOME;
  else process.env.ANJIAN_CLIENT_HOME = previous;
  fs.rmSync(home, { recursive: true, force: true });
});
const command = (name: string) => remoteCommands.find((entry) => entry.name === name)!;
const run = async (name: string, values: Record<string, string | boolean | undefined> = {}, positionals: string[] = []) => {
  const out: Record<string, unknown>[] = [];
  await command(name).run({ projectDir: project, values, positionals }, (event) => out.push(event));
  return out;
};
const doc = (text: string) => ({ 'doc.xml': Buffer.from(`<doc><p>${text}</p></doc>`).toString('base64') });

function fixtureServer() {
  let files: Record<string, string> = {};
  let revision: string | null = null;
  let nextRevision = 0;
  const requests: { path: string; authorization: string | undefined }[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    requests.push({ path: url.pathname, authorization: req.headers.authorization });
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/remote/auth/device') { send(200, { deviceCode: 'device-code', userCode: 'TEST-ABCD', verificationUri: `http://${req.headers.host}/connect`, expiresIn: 20, interval: 1 }); return; }
    if (url.pathname === '/api/remote/auth/token') { send(200, { token: 'secret-token', device: { id: 'd1', name: 'Laptop', projects: ['p1'] }, expiresAt: Date.now() + 60_000 }); return; }
    if (url.pathname === '/api/remote/projects') { send(200, { projects: [{ id: 'p1', name: 'Personal' }] }); return; }
    if (url.pathname === '/api/remote/auth/session') {
      if (req.method === 'DELETE') { send(200, {}); return; }
      send(200, { id: 'd1', name: 'Laptop', projects: ['p1'] }); return;
    }
    if (url.pathname === '/api/remote/projects/p1/agent/document/demo/comments') { send(200, { threads: [] }); return; }
    if (url.pathname === '/api/remote/projects/p1/events') { send(200, { cursor: '1', events: [{ id: '1', artifact: 'document/demo', type: 'comment', data: { text: 'hello' } }] }); return; }
    if (url.pathname === '/api/remote/projects/p1/artifacts/document/demo') {
      if (req.method === 'GET') { send(200, { revision, files }); return; }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { baseRevision: string | null; files: Record<string, string> };
        if (body.baseRevision !== revision) { send(409, { error: 'revision_conflict' }); return; }
        files = body.files; revision = `r${++nextRevision}`;
        send(200, { revision, files, url: 'http://127.0.0.1/document/demo' });
      });
      return;
    }
    send(404, { error: 'unknown' });
  });
  return {
    server, requests,
    async origin() { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}`; },
    close() { return new Promise<void>((resolve) => server.close(() => resolve())); },
    mutate(value: Record<string, string>) { files = value; revision = `r${++nextRevision}`; },
  };
}

describe('remote CLI', () => {
  test('opens a code-prefilled approval URL and stores only the returned credential locally', async () => {
    const api = fixtureServer(); const origin = await api.origin();
    try {
      const events = await run('login', { name: 'Laptop', 'no-open': true }, [origin]);
      expect(events.map((event) => event.type)).toEqual(['remote-login-pending', 'remote-login']);
      expect(events[0]!.verificationUri).toBe(`${origin}/connect?code=TEST-ABCD`);
      expect(JSON.stringify(events)).not.toContain('secret-token');
      expect(readConfig().servers[origin]!.token).toBe('secret-token');
    } finally { await api.close(); }
  });

  test('serializes same-artifact operations and refuses a stale local replacement', async () => {
    const order: string[] = [];
    await Promise.all([
      withArtifactLock(project, 'document/demo', async () => { order.push('first-start'); await sleep(40); order.push('first-end'); }),
      withArtifactLock(project, 'document/demo', async () => { order.push('second-start'); }),
    ]);
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    applyLocalFiles(project, 'document/demo', doc('initial'));
    const expected = filesHash(localFiles(project, 'document/demo'));
    applyLocalFiles(project, 'document/demo', doc('agent edit'));
    expect(() => applyLocalFiles(project, 'document/demo', doc('server'), expected)).toThrow('changed locally');
    expect(localFiles(project, 'document/demo')).toEqual(doc('agent edit'));
  });

  test('refuses a symlinked backup location', () => {
    fs.mkdirSync(clientHome(), { recursive: true });
    fs.symlinkSync(home, path.join(clientHome(), 'backups'));
    expect(() => backupHome()).toThrow('symlink');
  });

  test('stores credentials privately, links a project, synchronizes revisions, and uses bearer for comments', async () => {
    const api = fixtureServer(); const origin = await api.origin();
    try {
      updateConfig((config) => { config.servers[origin] = { token: 'secret-token', expiresAt: Date.now() + 60_000, deviceId: 'd1', deviceName: 'Laptop' }; });
      expect(fs.statSync(path.join(clientHome(), 'connections.json')).mode & 0o077).toBe(0);
      const linked = await run('link', { server: origin }); expect(linked[0]!.type).toBe('remote-linked');
      applyLocalFiles(project, 'document/demo', doc('one'));
      const pushed = await run('push', { artifact: 'document/demo' }); expect(pushed[0]!.revision).toBe('r1');
      const sync = readConfig().bindings[project]!.revisions['document/demo']!;
      expect(sync.remote).toBe('r1'); expect(sync.local).toBe(filesHash(localFiles(project, 'document/demo')));
      expect((await serverClient(project).call('POST', '/api/agent/document/demo/comments', { op: 'list' })).status).toBe(200);
      expect(api.requests.find((entry) => entry.path.endsWith('/comments'))!.authorization).toBe('Bearer secret-token');
      expect(api.requests.every((entry) => !entry.path.includes('secret-token'))).toBe(true);
      const events = await run('watch', { once: true }); expect(events[0]!.eventType).toBe('comment');
      expect(readConfig().bindings[project]!.cursor).toBe('1');
      await run('logout', {}, [origin]);
      expect(readConfig().servers[origin]).toBeUndefined();
    } finally { await api.close(); }
  });

  test('refuses unsafe pull and remote overwrite, but explicit backup preserves local files', async () => {
    const api = fixtureServer(); const origin = await api.origin();
    try {
      updateConfig((config) => { config.servers[origin] = { token: 'secret-token', expiresAt: Date.now() + 60_000, deviceId: 'd1', deviceName: 'Laptop' }; });
      await run('link', { server: origin });
      applyLocalFiles(project, 'document/demo', doc('local'));
      api.mutate(doc('remote'));
      await expect(run('push', { artifact: 'document/demo' })).rejects.toThrow('already exists remotely');
      await expect(run('pull', { artifact: 'document/demo' })).rejects.toThrow('refusing to overwrite');
      const result = await run('pull', { artifact: 'document/demo', 'backup-local': true });
      const backup = result[0]!.backup as string;
      expect(fs.existsSync(backup)).toBe(true);
      expect(JSON.parse(fs.readFileSync(backup, 'utf8')).files).toEqual(doc('local'));
      expect(localFiles(project, 'document/demo')).toEqual(doc('remote'));
      applyLocalFiles(project, 'document/demo', doc('edited'));
      api.mutate(doc('other remote edit'));
      await expect(run('push', { artifact: 'document/demo' })).rejects.toThrow('changed remotely');
    } finally { await api.close(); }
  });

  test('preserves special JavaScript property names as ordinary asset names', () => {
    const files = JSON.parse('{"index.html":"PGgxPk9LPC9oMT4=","__proto__":"YXNzZXQ="}');
    applyLocalFiles(project, 'html/demo', files);
    expect(Object.hasOwn(localFiles(project, 'html/demo'), '__proto__')).toBe(true);
    expect(localFiles(project, 'html/demo')['__proto__']).toBe('YXNzZXQ=');
  });

  test('rejects symlink traversal and leaves comment state alone', () => {
    applyLocalFiles(project, 'document/demo', doc('one'));
    const dir = path.join(project, '.anjian/artifacts/document/demo');
    fs.writeFileSync(path.join(dir, 'comments.json'), 'server managed');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.symlinkSync(path.join(home, 'outside'), path.join(dir, 'assets', 'escape'));
    expect(() => localFiles(project, 'document/demo')).toThrow('symlink');
    fs.unlinkSync(path.join(dir, 'assets', 'escape'));
    expect(() => applyLocalFiles(project, 'document/demo', { '../bad': 'YQ==' })).toThrow('Invalid');
    applyLocalFiles(project, 'document/demo', doc('two'));
    expect(fs.readFileSync(path.join(dir, 'comments.json'), 'utf8')).toBe('server managed');
  });
});
