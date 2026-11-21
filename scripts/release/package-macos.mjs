import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildInfo, hashFile } from './build-info.mjs';
import { root } from './versions.mjs';

const [output, sha, architecture] = process.argv.slice(2);
if (
  !output ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  !['arm64', 'x64'].includes(architecture) ||
  process.platform !== 'darwin' ||
  process.arch !== architecture
) {
  throw new Error(
    'Usage on the target Mac: node scripts/release/package-macos.mjs <output-dir> <commit> <arm64|x64>',
  );
}

const info = buildInfo();
if (info.sha !== sha || info.state !== 'clean')
  throw new Error('Packaging requires the exact clean source checkout');

const node = fs.realpathSync(process.execPath);
const distribution = path.dirname(path.dirname(node));
const nodeLicense = path.join(distribution, 'LICENSE');
if (!fs.existsSync(nodeLicense))
  throw new Error('Use an official Node.js binary distribution with its LICENSE.');

const artifact = `anjian-v${info.version}-darwin-${architecture}`;
const directory = path.resolve(output);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-package-'));
const bundle = path.join(temporary, artifact);
const dist = path.join(root, 'artifacts/dist');

function copyNotices(target) {
  // Include notice files for the installed dependency tree. The bundles also retain inline legal comments.
  const store = path.join(root, 'artifacts/node_modules/.pnpm');
  const recorded = new Set();
  for (const entry of fs.readdirSync(store).sort()) {
    const modules = path.join(store, entry, 'node_modules');
    if (!fs.existsSync(modules)) continue;
    const directories = fs.readdirSync(modules, { withFileTypes: true });
    for (const { name } of directories.filter((item) => item.isDirectory())) {
      const location = path.join(modules, name);
      const packages = name.startsWith('@')
        ? fs
            .readdirSync(location, { withFileTypes: true })
            .filter((item) => item.isDirectory())
            .map((item) => path.join(location, item.name))
        : [location];
      for (const dependency of packages) {
        const manifest = path.join(dependency, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        const { name, version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        const identity = `${name}@${version}`;
        if (recorded.has(identity)) continue;
        recorded.add(identity);
        for (const notice of fs.readdirSync(dependency, { withFileTypes: true })) {
          if (
            !notice.isFile() ||
            !/^(?:licen[cs]e|notice|copying|copyright|authors|third[-_ ]party)(?:[._-]|$)/i.test(
              notice.name,
            )
          )
            continue;
          const destination = path.join(target, identity, notice.name);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(path.join(dependency, notice.name), destination);
        }
      }
    }
  }
}

function sortedEntries(directory, prefix) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))
    .flatMap((entry) => {
      const relative = `${prefix}/${entry.name}`;
      return entry.isDirectory()
        ? [relative, ...sortedEntries(path.join(directory, entry.name), relative)]
        : [relative];
    });
}

try {
  const payload = path.join(bundle, 'dist');
  const runtime = path.join(bundle, 'lib');
  const notices = path.join(bundle, 'licenses');
  fs.mkdirSync(payload, { recursive: true });
  fs.mkdirSync(runtime);
  fs.mkdirSync(notices);

  for (const file of ['cli.cjs', 'server.cjs', 'viewer', 'runtime'])
    fs.cpSync(path.join(dist, file), path.join(payload, file), { recursive: true });
  const bundledNode = path.join(runtime, 'node');
  fs.copyFileSync(node, bundledNode);
  fs.chmodSync(bundledNode, 0o755);
  fs.copyFileSync(nodeLicense, path.join(notices, 'Node.js.txt'));
  for (const [source, name] of [
    ['LICENSE', 'Anjian-MIT.txt'],
    ['artifacts/LICENSE', 'Anjian-AGPL-3.0.txt'],
    ['UPSTREAM.md', 'UPSTREAM.md'],
  ])
    fs.copyFileSync(path.join(root, source), path.join(notices, name));
  copyNotices(path.join(notices, 'dependencies'));

  fs.writeFileSync(
    path.join(bundle, 'anjian'),
    [
      '#!/bin/sh',
      'set -eu',
      'bundle=$(CDPATH= cd -P "$(dirname "$0")" && pwd)',
      'exec "$bundle/lib/node" "$bundle/dist/cli.cjs" "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const version = JSON.parse(
    execFileSync(path.join(bundle, 'anjian'), ['version', '--json'], { encoding: 'utf8' }),
  );
  if (version.version !== info.version || version.sha !== sha || version.state !== 'clean')
    throw new Error('Compiled CLI identity does not match the package source checkout');

  const repositoryUrl = 'https://github.com/yusixian/anjian';
  fs.writeFileSync(
    path.join(bundle, 'build.json'),
    `${JSON.stringify(
      {
        version: info.version,
        commit: sha,
        platform: 'darwin',
        architecture,
        node: process.version,
        source: `${repositoryUrl}/archive/${sha}.tar.gz`,
        nodeSource: `https://nodejs.org/dist/${process.version}/node-${process.version}.tar.gz`,
        install: `${repositoryUrl}/blob/${sha}/docs/install.md`,
      },
      null,
      2,
    )}\n`,
  );

  const entries = [artifact, ...sortedEntries(bundle, artifact)];
  const timestamp = new Date('2000-01-01T00:00:00Z');
  for (const file of entries) {
    const destination = path.join(temporary, file);
    const mode = fs.statSync(destination).mode;
    fs.chmodSync(destination, mode & 0o111 ? 0o755 : 0o644);
    fs.utimesSync(destination, timestamp, timestamp);
  }
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${artifact}.tar.gz`;
  const archive = path.join(directory, filename);
  execFileSync(
    '/usr/bin/tar',
    [
      '--format',
      'ustar',
      '--uid',
      '0',
      '--gid',
      '0',
      '--uname',
      'root',
      '--gname',
      'wheel',
      '--no-recursion',
      '-czf',
      archive,
      '-C',
      temporary,
      '-T',
      '-',
    ],
    {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      input: `${entries.join('\n')}\n`,
    },
  );
  fs.writeFileSync(`${archive}.sha256`, `${hashFile(archive)}  ${filename}\n`);
  console.info(archive);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
