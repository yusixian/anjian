import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { checkRelease } from '../check-release.mjs';
import { buildInfo } from './build-info.mjs';
import { releaseBody } from './notes.mjs';
import { root } from './versions.mjs';

function read(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', `repos/yusixian/anjian/${endpoint}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
export function prepareDeployment(
  sha,
  info,
  api = read,
  gate = checkRelease,
  exportContext = () => {
    execFileSync(process.execPath, ['scripts/release/build-info.mjs', '--export'], {
      cwd: root,
      stdio: 'inherit',
    });
  },
) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || info.sha !== sha || info.state !== 'clean') {
    throw new Error('Deployment requires the exact clean release checkout');
  }
  releaseBody(info.version, info.notes);
  const checks = gate([sha]);
  const tag = `v${info.version}`;
  const ref = api(`git/ref/tags/${tag}`);
  const release = api(`releases/tags/${tag}`);
  if (
    ref.object.type !== 'commit' ||
    ref.object.sha !== sha ||
    release.target_commitish !== sha ||
    release.draft ||
    release.prerelease
  ) {
    throw new Error('Deployment requires a matching immutable tag and published stable Release');
  }
  exportContext();
  return {
    version: info.version,
    sha,
    tag,
    ci: checks.url,
    release: release.html_url,
    context: '.anjian-build.json',
    deployment: 'not started',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.info(JSON.stringify(prepareDeployment(process.argv[2], buildInfo()), null, 2));
}
