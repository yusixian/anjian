import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = 'yusixian/anjian';
const workflow = 'viewer-release-guard.yml';

function github(endpoint) {
  // Do not echo API error bodies: deployment logs must not collect credentials.
  try {
    return JSON.parse(
      execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      }),
    );
  } catch {
    throw new Error('GitHub 读取失败；检查 gh 登录、网络与 API 限流后重跑。');
  }
}

export function checkRelease(args, api = github) {
  const [sha, flag, pr] = args;
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? '') ||
    (args.length !== 1 &&
      !(args.length === 3 && ['--pr', '--pr-dispatch'].includes(flag) && /^[1-9]\d*$/.test(pr)))
  ) {
    throw new Error(
      '用法：node scripts/check-release.mjs <完整小写 SHA> [--pr <编号> | --pr-dispatch <编号>]',
    );
  }
  const readPR = () => {
    const [value] = api(`repos/${repo}/pulls/${pr}`);
    if (value.head?.sha !== sha || value.head?.repo?.full_name !== repo || value.state !== 'open') {
      throw new Error('PR 必须仍开放，且当前 head 与指定仓库和 SHA 一致。');
    }
  };
  if (pr) readPR();
  const event = flag === '--pr-dispatch' ? 'workflow_dispatch' : pr ? 'pull_request' : 'push';
  const runs = api(
    `repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&event=${event}&per_page=100`,
  ).flatMap((page) => page.workflow_runs);
  const run = runs
    .filter((item) => item.head_sha === sha && item.event === event)
    .sort((a, b) => b.id - a.id)[0];
  if (!run) throw new Error(`指定 SHA 没有 ${event} CI；不能判为成功。`);
  const [current] = api(`repos/${repo}/actions/runs/${run.id}`);
  if (
    current.head_sha !== sha ||
    current.event !== event ||
    current.status !== 'completed' ||
    current.conclusion !== 'success'
  ) {
    throw new Error(`CI 未成功：run ${run.id} (${current.status}/${current.conclusion})`);
  }
  const jobs = api(
    `repos/${repo}/actions/runs/${run.id}/attempts/${current.run_attempt}/jobs?per_page=100`,
  ).flatMap((page) => page.jobs);
  for (const name of ['artifacts', 'release-checks']) {
    if (
      !jobs.some(
        (job) => job.name === name && job.status === 'completed' && job.conclusion === 'success',
      )
    ) {
      throw new Error(`CI 缺少成功的 ${name} job：run ${run.id} attempt ${current.run_attempt}`);
    }
  }
  if (pr) readPR();
  return {
    repository: repo,
    sha,
    event,
    run: run.id,
    attempt: current.run_attempt,
    url: current.html_url,
    result: 'CI passed',
    deployment: 'not checked',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(checkRelease(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
