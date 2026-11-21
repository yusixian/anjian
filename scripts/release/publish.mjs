import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkRelease } from '../check-release.mjs';
import { buildInfo, hashFile } from './build-info.mjs';
import { releaseBody } from './notes.mjs';

const repository = 'yusixian/anjian';
function request(endpoint, method = 'GET', data) {
  const args = ['api', `repos/${repository}/${endpoint}`, '--method', method];
  if (data) args.push('--input', '-');
  try {
    return JSON.parse(
      execFileSync('gh', args, {
        input: data ? JSON.stringify(data) : undefined,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  } catch {
    throw new Error(
      `GitHub ${method} failed for ${endpoint}; stop and inspect the run before retrying`,
    );
  }
}

function releaseAssets(directory, tag) {
  return ['arm64', 'x64'].flatMap((arch) => {
    const archive = `anjian-${tag}-darwin-${arch}.tar.gz`;
    const checksum = `${archive}.sha256`;
    const archivePath = path.resolve(directory, archive);
    const checksumPath = path.resolve(directory, checksum);
    const digest = hashFile(archivePath);
    const [expectedDigest, expectedName] = fs
      .readFileSync(checksumPath, 'utf8')
      .trim()
      .split(/\s+/);
    if (digest !== expectedDigest || archive !== expectedName)
      throw new Error(`Checksum mismatch: ${archive}`);
    return [
      { name: archive, file: archivePath, digest: `sha256:${digest}` },
      { name: checksum, file: checksumPath, digest: `sha256:${hashFile(checksumPath)}` },
    ];
  });
}

function uploadAssets(tag, files) {
  execFileSync('gh', ['release', 'upload', tag, '--repo', repository, '--', ...files], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function missingAssets(expected, uploaded) {
  return expected.filter((asset) => {
    const match = uploaded.find((item) => item.name === asset.name);
    if (match && (match.state !== 'uploaded' || match.digest !== asset.digest))
      throw new Error(`Release asset conflict: ${asset.name}`);
    return !match;
  });
}

export function publishRelease(
  { sha, info, previousVersion, assetsDirectory },
  api = request,
  gate = checkRelease,
  upload = uploadAssets,
) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || info.sha !== sha || info.state !== 'clean') {
    throw new Error('Release requires the exact clean checked-out commit');
  }
  if (previousVersion === info.version)
    throw new Error('This commit does not introduce a product version');
  const body = releaseBody(info.version, info.notes);
  const tag = `v${info.version}`;
  const assets = assetsDirectory === undefined ? null : releaseAssets(assetsDirectory, tag);
  const comparison = api(`compare/${sha}...main`);
  if (!['ahead', 'identical'].includes(comparison.status))
    throw new Error('Commit must belong to main');
  const checks = gate([sha]);
  const refs = api(`git/matching-refs/tags/${tag}`);
  const existing = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  // Only lightweight tags made by this pipeline are accepted. Never overwrite annotated or conflicting tags.
  if (existing && (existing.object.type !== 'commit' || existing.object.sha !== sha)) {
    throw new Error(`Tag conflict: ${tag}`);
  }
  let release;
  for (let page = 1; ; page++) {
    const releases = api(`releases?per_page=100&page=${page}`);
    release = releases.find((item) => item.tag_name === tag);
    if (release || releases.length < 100) break;
  }
  const expectedBody = `${body}\nCommit: ${sha}\nCI: https://github.com/${repository}/actions/workflows/viewer-release-guard.yml?query=${sha}\n\nDeployment is verified separately. / 部署需单独验证。\n`;
  if (
    release &&
    (!existing ||
      release.target_commitish !== sha ||
      (release.draft && !assets) ||
      release.prerelease ||
      release.body !== expectedBody)
  ) {
    throw new Error(`Release conflict: ${tag}; existing content is not overwritten`);
  }
  if (!existing) api('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha });
  if (!release)
    release = api('releases', 'POST', {
      tag_name: tag,
      target_commitish: sha,
      name: `Anjian ${info.version}`,
      body: expectedBody,
      draft: Boolean(assets),
      prerelease: false,
    });
  if (assets) {
    const endpoint = `releases/${release.id}/assets?per_page=100`;
    let missing = missingAssets(assets, api(endpoint));
    if (release.draft && missing.length) {
      upload(
        tag,
        missing.map((asset) => asset.file),
      );
      missing = missingAssets(assets, api(endpoint));
    }
    if (missing.length) throw new Error(`Release assets incomplete: ${tag}`);
    if (release.draft) release = api(`releases/${release.id}`, 'PATCH', { draft: false });
  }
  return { tag, sha, release: release.html_url, ci: checks.url, deployment: 'not checked' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = buildInfo();
  const previous = JSON.parse(
    execFileSync('git', ['show', 'HEAD^:package.json'], { encoding: 'utf8' }),
  );
  const result = publishRelease({
    sha: process.argv[2],
    info,
    previousVersion: previous.version,
    assetsDirectory: process.argv[3],
  });
  console.info(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
    );
}
