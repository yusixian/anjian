import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hashFile } from './build-info.mjs';

const [archive, expectedSha, expectedArch, mode] = process.argv.slice(2);
const name = path.basename(archive ?? '');
assert.match(name, /^anjian-v[^/]+-(darwin|linux)-(arm64|x64)\.(?:tar\.gz|dmg)$/);
const image = name.endsWith('.dmg');
assert.ok(!image || process.platform === 'darwin');
assert.ok(mode === undefined || (image && mode === '--notarized'));
assert.equal(fs.readFileSync(`${archive}.sha256`, 'utf8').trim(), `${hashFile(archive)}  ${name}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-install-'));
const installed = path.join(directory, image ? 'mounted image' : name.slice(0, -7));
const launcher = path.join(installed, 'anjian');
const project = path.join(directory, 'Example project');
const state = path.join(directory, 'server');
const essentialCommands = path.join(directory, 'bin');
const env = {
  PATH: essentialCommands,
  HOME: directory,
  ANJIAN_SERVER_HOME: state,
  ANJIAN_CLIENT_HOME: path.join(directory, 'cli-client'),
};
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: directory,
    env: command === launcher ? env : { ...env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    encoding: 'utf8',
    timeout: 30000,
  });
const anjian = (...args) =>
  JSON.parse(
    run(launcher, [...args, '--json'])
      .trim()
      .split('\n')
      .pop(),
  );
let mounted = false;
try {
  fs.mkdirSync(essentialCommands);
  fs.symlinkSync('/usr/bin/dirname', path.join(essentialCommands, 'dirname'));
  if (process.platform === 'darwin') fs.symlinkSync('/bin/ps', path.join(essentialCommands, 'ps'));
  if (image) {
    const file = path.resolve(archive);
    run('/usr/bin/hdiutil', ['verify', '-quiet', file]);
    if (mode === '--notarized') {
      run('/usr/bin/codesign', ['--verify', '--strict', file]);
      run('/usr/bin/xcrun', ['stapler', 'validate', file]);
      run('/usr/sbin/spctl', [
        '--assess',
        '--type',
        'open',
        '--context',
        'context:primary-signature',
        file,
      ]);
    }
    fs.mkdirSync(installed);
    run('/usr/bin/hdiutil', [
      'attach',
      '-quiet',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      installed,
      file,
    ]);
    mounted = true;
    run('/usr/bin/codesign', ['--verify', '--strict', path.join(installed, 'lib/node')]);
  } else run('/usr/bin/tar', ['-xzf', path.resolve(archive)]);
  const metadata = JSON.parse(fs.readFileSync(path.join(installed, 'build.json')));
  assert.deepEqual(
    [metadata.commit, metadata.platform, metadata.architecture],
    [expectedSha, process.platform, expectedArch],
  );
  assert.equal(run(path.join(installed, 'lib/node'), ['-p', 'process.arch']).trim(), expectedArch);
  assert.equal(
    run(path.join(installed, 'lib/node'), ['-p', 'process.version']).trim(),
    metadata.node,
  );
  assert.ok(!fs.existsSync(path.join(installed, 'node_modules')));
  for (const file of ['Node.js.txt', 'Anjian-AGPL-3.0.txt', 'Anjian-MIT.txt'])
    assert.ok(fs.statSync(path.join(installed, 'licenses', file)).size > 0);

  const version = anjian('version');
  assert.deepEqual(version, {
    type: 'cli-version',
    version: metadata.version,
    sha: expectedSha,
    state: 'clean',
  });
  assert.match(run(launcher, ['skills', 'get', 'artifacts']), /artifacts/i);
  const work = path.join(project, '.anjian/artifacts/html/smoke');
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, 'index.html');
  fs.writeFileSync(source, '<!doctype html><p>Anjian standalone package smoke</p>');
  const started = anjian(
    'start',
    '--project-dir',
    project,
    '--background',
    '--no-open',
    '--artifact',
    'html/smoke',
  );
  assert.equal(started.type, 'server-started');
  const base = new URL(started.url);
  base.pathname = '/api/status';
  const statusResponse = await fetch(base, { signal: AbortSignal.timeout(5000) });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.build.sha, expectedSha);
  assert.equal(status.build.version, version.version);
  const page = await fetch(started.link, { signal: AbortSignal.timeout(5000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script[^>]+src=/);
  assert.equal(anjian('stop').status, 'stopped');
  await assert.rejects(fetch(base, { signal: AbortSignal.timeout(3000) }));
  assert.match(fs.readFileSync(source, 'utf8'), /Anjian standalone package smoke/);
  console.info(`Verified ${name} with no Node.js or pnpm on PATH.`);
} finally {
  try {
    if (fs.existsSync(path.join(state, 'server.pid'))) anjian('stop');
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', '-quiet', installed]);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
