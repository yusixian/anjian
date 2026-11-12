import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { checkRelease } from '../check-release.mjs';
import { buildInfo } from './build-info.mjs';
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

export function publishRelease({ sha, info, previousVersion }, api = request, gate = checkRelease) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || info.sha !== sha || info.state !== 'clean') {
    throw new Error('Release requires the exact clean checked-out commit');
  }
  if (previousVersion === info.version)
    throw new Error('This commit does not introduce a product version');
  const body = releaseBody(info.version, info.notes);
  const tag = `v${info.version}`;
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
      release.draft ||
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
      draft: false,
      prerelease: false,
    });
  return { tag, sha, release: release.html_url, ci: checks.url, deployment: 'not checked' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = buildInfo();
  const previous = JSON.parse(
    execFileSync('git', ['show', 'HEAD^:package.json'], { encoding: 'utf8' }),
  );
  const result = publishRelease({ sha: process.argv[2], info, previousVersion: previous.version });
  console.info(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`,
    );
}
