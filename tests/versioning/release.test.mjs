import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildInfo, hashFile } from '../../scripts/release/build-info.mjs';
import { currentNotes, parseNotes } from '../../scripts/release/notes.mjs';
import { publishRelease } from '../../scripts/release/publish.mjs';
import { root, syncVersions } from '../../scripts/release/versions.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-version-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of [
    '.version-bump.json',
    ...JSON.parse(fs.readFileSync(path.join(root, '.version-bump.json'))).files.map(
      (entry) => entry.path,
    ),
  ]) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  return directory;
}
const note =
  '<!-- anjian:zh -->\n#### 中文\n中文变化\n<!-- anjian:en -->\n#### English\nEnglish change\n<!-- anjian:end -->';
test('synchronizes every declared field from the private root; drift and missing manifests fail', (t) => {
  const directory = fixture(t);
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const nextVersion = `${Number(pkg.version.split('.')[0]) + 1}.0.0`;
  pkg.version = nextVersion;
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(pkg));
  assert.throws(() => syncVersions(directory, true), /drift/);
  assert.equal(syncVersions(directory), nextVersion);
  assert.equal(syncVersions(directory, true), nextVersion);
  fs.rmSync(path.join(directory, 'gemini-extension.json'));
  assert.throws(() => syncVersions(directory), /ENOENT/);
});
test('notes select only the exact version and require both languages in new changesets', (t) => {
  const directory = fixture(t);
  fs.writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    `# Changelog\n\n## 0.2.0\n\n${note}\n\n## 0.1.0\n\nNo recorded translations\n`,
  );
  assert.deepEqual(currentNotes(directory, '0.2.0'), { zh: '中文变化', en: 'English change' });
  assert.deepEqual(currentNotes(directory, '0.1.0'), { zh: '', en: '' });
  assert.deepEqual(currentNotes(directory, '0.3.0'), { zh: '', en: '' });
  assert.throws(() => parseNotes(note.replace('English change', ''), true), /Missing en/);
  assert.throws(() => parseNotes('中文', true), /requires/);
});
test('released notes retain language headings at the same level as the version', (t) => {
  const directory = fixture(t);
  const titled = note.replaceAll('#### ', '## ');
  const older = note.replace('中文变化', '旧版本').replace('English change', 'Older release');
  fs.writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    ['# Changelog', '## 0.5.0', titled, '## Details', note, '## 0.4.0', older].join('\n\n'),
  );
  assert.deepEqual(currentNotes(directory, '0.5.0'), {
    zh: '中文变化\n\n中文变化',
    en: 'English change\n\nEnglish change',
  });
  assert.deepEqual(currentNotes(directory, '0.4.0'), { zh: '旧版本', en: 'Older release' });
});
test('build identity distinguishes clean, dirty, source export and unknown', (t) => {
  const directory = fixture(t);
  const git = (args) =>
    args.includes('--show-toplevel') ? directory : args.includes('HEAD') ? 'a'.repeat(40) : '';
  assert.equal(buildInfo(directory, git).state, 'clean');
  assert.equal(
    buildInfo(directory, (args) => (args[0] === 'status' ? ' M package.json' : git(args))).state,
    'dirty',
  );
  const unknown = () => {
    throw new Error('no git');
  };
  assert.equal(buildInfo(directory, unknown).sha, null);
  fs.writeFileSync(
    path.join(directory, '.anjian-build.json'),
    JSON.stringify({
      ...buildInfo(directory, git),
      files: { 'package.json': hashFile(path.join(directory, 'package.json')) },
    }),
  );
  assert.equal(buildInfo(directory, unknown).state, 'exported');
  fs.appendFileSync(path.join(directory, 'package.json'), ' ');
  assert.throws(() => buildInfo(directory, unknown), /source changed/);
  fs.writeFileSync(path.join(directory, '.anjian-build.json'), '{}');
  assert.throws(() => buildInfo(directory, unknown), /Invalid/);
});
const sha = 'a'.repeat(40);
function publishing() {
  const input = {
    sha,
    previousVersion: '0.1.0',
    info: { sha, state: 'clean', version: '0.2.0', notes: { zh: '变化', en: 'Change' } },
  };
  const store = { tag: null, release: null, assets: [], writes: 0 };
  const api = (endpoint, method, data) => {
    if (method === 'POST') {
      store.writes++;
      if (endpoint === 'git/refs')
        return (store.tag = { ref: data.ref, object: { type: 'commit', sha: data.sha } });
      return (store.release = { ...data, id: 1, html_url: 'https://example.test/release' });
    }
    if (method === 'PATCH' && endpoint === 'releases/1') {
      assert.equal(store.release.draft, true);
      assert.equal(store.assets.length, 8);
      store.writes++;
      return (store.release = { ...store.release, ...data });
    }
    if (method === 'DELETE' && endpoint === 'releases/assets/2') {
      assert.equal(store.release.draft, true);
      store.assets = store.assets.filter((item) => item.id !== 2);
      store.writes++;
      return;
    }
    if (endpoint.startsWith('releases/1/assets?')) return store.assets;
    if (endpoint.startsWith('compare/')) return { status: 'ahead' };
    if (endpoint.startsWith('git/matching')) return store.tag ? [store.tag] : [];
    return store.release ? [store.release] : [];
  };
  return { input, store, api, gate: () => ({ url: 'https://example.test/checks' }) };
}
test('release retries do not duplicate tags or releases, including interrupted after tag creation', () => {
  const { input, store, api, gate } = publishing();
  let interrupted = true;
  assert.throws(
    () =>
      publishRelease(
        input,
        (endpoint, method, data) => {
          if (endpoint === 'releases' && interrupted) {
            interrupted = false;
            throw new Error('interrupted');
          }
          return api(endpoint, method, data);
        },
        gate,
      ),
    /interrupted/,
  );
  publishRelease(input, api, gate);
  publishRelease(input, api, gate);
  assert.equal(store.writes, 2);
});
test('failed CI, dirty identity, unchanged version and conflicting tags or releases fail closed', () => {
  const { input, store, api, gate } = publishing();
  assert.throws(
    () =>
      publishRelease(input, api, () => {
        throw new Error('failed CI');
      }),
    /failed CI/,
  );
  assert.equal(store.writes, 0);
  assert.throws(
    () => publishRelease({ ...input, previousVersion: '0.2.0' }, api, gate),
    /introduce/,
  );
  assert.throws(
    () => publishRelease({ ...input, info: { ...input.info, state: 'dirty' } }, api, gate),
    /clean/,
  );
  store.tag = { ref: 'refs/tags/v0.2.0', object: { type: 'commit', sha: 'b'.repeat(40) } };
  assert.throws(() => publishRelease(input, api, gate), /Tag conflict/);
  store.tag.object.sha = sha;
  store.release = { tag_name: 'v0.2.0', target_commitish: 'main' };
  assert.throws(() => publishRelease(input, api, gate), /Release conflict/);
  assert.equal(store.writes, 0);
});
function packageAssets(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-assets-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const names = ['darwin', 'linux'].flatMap((platform) =>
    ['arm64', 'x64'].map((arch) => `anjian-v0.2.0-${platform}-${arch}.tar.gz`),
  );
  for (const name of names) {
    const file = path.join(directory, name);
    fs.writeFileSync(file, name);
    fs.writeFileSync(`${file}.sha256`, `${hashFile(file)}  ${name}\n`);
  }
  return { directory, names };
}

test('requires complete matching macOS and Linux packages before creating a tag or release', (t) => {
  const { input, store, api, gate } = publishing();
  const { directory, names } = packageAssets(t);
  const publish = () => publishRelease({ ...input, assetsDirectory: directory }, api, gate);
  fs.appendFileSync(path.join(directory, names[0]), 'modified');
  assert.throws(publish, /Checksum mismatch/);
  fs.writeFileSync(path.join(directory, names[0]), names[0]);
  fs.rmSync(path.join(directory, `${names.at(-1)}.sha256`));
  assert.throws(publish, /ENOENT/);
  assert.equal(store.writes, 0);
});

test('resumes a partially uploaded draft and verifies published assets without changing them', (t) => {
  const { input, store, api, gate } = publishing();
  const { directory } = packageAssets(t);
  const asset = (file) => ({
    name: path.basename(file),
    state: 'uploaded',
    digest: `sha256:${hashFile(file)}`,
  });
  const publish = (upload) =>
    publishRelease({ ...input, assetsDirectory: directory }, api, gate, upload);
  assert.throws(
    () =>
      publish((tag, files) => {
        assert.equal(tag, 'v0.2.0');
        assert.equal(store.release.draft, true);
        assert.equal(files.length, 8);
        store.assets.push(asset(files[0]), {
          id: 2,
          state: 'starter',
          size: 0,
          name: path.basename(files[1]),
        });
        throw new Error('upload interrupted');
      }),
    /upload interrupted/,
  );
  assert.equal(store.release.draft, true);
  assert.throws(() => publish(() => {}), /Release assets incomplete/);
  publish((_, files) => {
    assert.equal(files.length, 7);
    assert(!files.some((file) => path.basename(file) === store.assets[0].name));
    store.assets.push(...files.map(asset));
  });
  assert.equal(store.release.draft, false);
  const unexpectedUpload = () => assert.fail('published release assets must not be changed');
  publish(unexpectedUpload);
  store.assets.pop();
  assert.throws(() => publish(unexpectedUpload), /Release assets incomplete/);
  store.assets[0].digest = 'sha256:conflicting';
  assert.throws(() => publish(unexpectedUpload), /Release asset conflict/);
  assert.equal(store.writes, 4);
});

test('legacy bump command cannot decide a new version', () => {
  assert.throws(() =>
    execFileSync('bash', ['scripts/bump-version.sh', '9.9.9'], { cwd: root, stdio: 'pipe' }),
  );
});
