import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { HubArtifact } from '../src/shared/hub';
import { createHubTrash } from '../src/server/hub-trash';
import { artifactPath } from '../src/server/artifact-address';
import { listTrash } from '../src/server/artifact-trash';

const servers: http.Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-member-trash-')));
  directories.push(home);
  const projects = [path.join(home, 'alice'), path.join(home, 'bob')];
  const artifacts: HubArtifact[] = projects.map((project, index) => {
    const root = path.join(project, '.anjian/artifacts');
    fs.mkdirSync(path.join(root, 'html/example'), { recursive: true });
    fs.writeFileSync(path.join(root, 'html/example/index.html'), `<h1>Private ${index}</h1>`);
    return { project, type: 'html', id: 'example', url: artifactPath(root, 'html', 'example'), title: 'Private', updatedAt: 1 };
  });
  let active = true;
  let revokeDuringSuspend = false;
  const scope = (req: http.IncomingMessage) => active && req.headers.cookie === 'alice' ? [projects[0]!] : [];
  const api = createHubTrash({
    deployment: 'self-hosted', projects: scope,
    artifacts: (req) => artifacts.filter((a) => scope(req).includes(a.project)),
    projectReference: (_req, project) => project === projects[0] ? 'opaque-alice' : 'opaque-bob',
    resolveProject: (req, ref) => ref === 'opaque-alice' && scope(req).length ? projects[0]! : null,
    readBody: async (req) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()); },
    suspend: async (_project, work) => { if (revokeDuringSuspend) active = false; return work(); },
  });
  const server = http.createServer((req, res) => { void api(req, res, req.url!).catch(() => { res.statusCode = 500; res.end(); }); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const request = (suffix = '', items?: unknown[]) => fetch(`http://127.0.0.1:${port}/api/hub/trash${suffix}`, {
    method: items ? 'POST' : 'GET', headers: { Cookie: 'alice', 'Content-Type': 'application/json' },
    ...(items ? { body: JSON.stringify({ items }) } : {}),
  }).then((response) => response.json());
  return { projects, artifacts, request, revoke: () => { revokeDuringSuspend = true; } };
}

test('members trash and restore only their own objects using opaque project references', async () => {
  const f = await fixture();
  const result = await f.request('', [
    { ...f.artifacts[1], project: 'opaque-bob' },
    { ...f.artifacts[1] },
    { ...f.artifacts[0], project: 'opaque-alice' },
  ]);
  expect(result.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false, true]);
  const entry = result.results[2].entry;
  expect(entry.project).toBe('opaque-alice');
  expect(listTrash(f.projects[1]!)).toHaveLength(0);
  const listing = await f.request();
  expect(listing.entries).toHaveLength(1);
  expect(JSON.stringify(listing)).not.toContain(f.projects[0]);
  expect((await f.request('/restore', [{ project: 'opaque-alice', trashId: entry.trashId }])).results[0].ok).toBe(true);
  expect(fs.existsSync(path.join(f.projects[0]!, '.anjian/artifacts/html/example/index.html'))).toBe(true);
});

test('suspension while waiting for a project prevents the pending mutation', async () => {
  const f = await fixture();
  f.revoke();
  const result = await f.request('', [{ ...f.artifacts[0], project: 'opaque-alice' }]);
  expect(result.results[0]).toMatchObject({ ok: false, code: 'project_not_found' });
  expect(listTrash(f.projects[0]!)).toHaveLength(0);
  expect((await f.request()).entries).toEqual([]);
});
