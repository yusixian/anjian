import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { tempRoot } from './helpers';

test('public docs coexist with authenticated library and APIs without exposing other files', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-docs-test-'));
  const docs = path.join(home, 'docs');
  fs.mkdirSync(path.join(docs, 'docs', 'local'), { recursive: true });
  fs.mkdirSync(path.join(docs, 'api'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'index.html'), 'Public docs');
  fs.writeFileSync(path.join(docs, '__next._tree.txt'), 'Root RSC tree');
  fs.writeFileSync(path.join(docs, 'docs', 'local', 'index.html'), 'Local guide');
  fs.writeFileSync(path.join(docs, 'api', 'search'), '{"search":true}');
  for (const locale of ['zh', 'en']) {
    fs.mkdirSync(path.join(docs, locale, 'docs', 'local'), { recursive: true });
    fs.writeFileSync(path.join(docs, locale, 'index.html'), `${locale} home`);
    fs.writeFileSync(path.join(docs, locale, '__next._tree.txt'), `${locale} RSC`);
    fs.writeFileSync(path.join(docs, locale, '__next.$d$lang.txt'), `${locale} segment`);
    fs.writeFileSync(path.join(docs, locale, 'docs', 'local', 'index.html'), `${locale} guide`);
    fs.writeFileSync(path.join(docs, locale, 'private.txt'), 'must not be served');
  }
  fs.writeFileSync(path.join(home, 'secret'), 'private data');
  fs.symlinkSync(path.join(home, 'secret'), path.join(docs, 'docs', 'leak'));
  const temp = tempRoot();
  const hub = await startHub({
    host: '127.0.0.1',
    urlHost: 'localhost',
    publicOrigin: 'http://localhost',
    ports: [0],
    boardPorts: [0],
    viewerDir: temp.viewer,
    runtimeDir: temp.runtime,
    docsDir: docs,
    paths: machinePaths({ ANJIAN_SERVER_HOME: home }),
    token: 't'.repeat(48),
    version: 'test',
  });
  const get = (route: string, extra: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${hub.port}${route}`, {
      redirect: 'manual',
      ...extra,
      headers: { Host: 'localhost', ...extra.headers },
    });
  try {
    expect(await (await get('/')).text()).toBe('Public docs');
    expect(await (await get('/__next._tree.txt')).text()).toBe('Root RSC tree');
    expect(await (await get('/docs/local/')).text()).toBe('Local guide');
    for (const locale of ['zh', 'en']) {
      expect(await (await get(`/${locale}/`)).text()).toBe(`${locale} home`);
      expect(await (await get(`/${locale}/docs/local/`)).text()).toBe(`${locale} guide`);
      expect(await (await get(`/${locale}/__next._tree.txt`)).text()).toBe(`${locale} RSC`);
      expect(await (await get(`/${locale}/__next.$d$lang.txt`)).text()).toBe(`${locale} segment`);
      expect(await (await get(`/${locale}/private.txt`)).text()).not.toBe('must not be served');
      expect((await get(`/${locale}/docs/%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret`)).status).toBe(404);
      expect((await get(`/${locale}/docs/local/`, { method: 'POST' })).status).toBe(405);
    }
    expect((await get('/api/search')).headers.get('content-type')).toContain('application/json');
    expect((await get('/docs/leak')).status).toBe(404);
    expect((await get('/docs/%2e%2e%2fsecret')).status).toBe(404);
    expect((await get('/', { method: 'POST' })).status).toBe(405);
    expect((await get('/', { method: 'HEAD' })).status).toBe(200);
    expect((await get('/api/hub/projects')).status).toBe(403);
    const library = await get('/library');
    expect(library.status).toBe(303);
    expect(library.headers.get('location')).toContain('returnTo=%2Flibrary');
    expect(await (await get('/login')).text()).toContain('value="/library"');
    const signedIn = { Cookie: `anjian_artifacts_${hub.port}=${hub.token}` };
    expect((await get('/library', { headers: signedIn })).status).toBe(200);
    expect(await (await get('/library', { headers: signedIn })).text()).not.toBe('Public docs');
    expect(await (await get(`/?key=${hub.token}`)).text()).not.toBe('Public docs');
  } finally {
    await hub.close();
  }
});
