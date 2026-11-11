import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { checkRelease } from '../../scripts/check-release.mjs';

const sha = 'a'.repeat(40);
const run = {
  id: 20,
  head_sha: sha,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 2,
};
const jobs = ['artifacts', 'release-checks'].map((name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
}));
function fixture({ runs = [run], current = run, tasks = jobs, prHead = sha } = {}) {
  return (endpoint) => {
    if (endpoint.includes('/pulls/'))
      return [{ state: 'open', head: { sha: prHead, repo: { full_name: 'yusixian/anjian' } } }];
    if (endpoint.includes('/workflows/')) return [{ workflow_runs: [] }, { workflow_runs: runs }];
    if (endpoint.includes('/jobs?')) {
      assert.match(endpoint, /\/attempts\/2\/jobs/);
      return [{ jobs: tasks.slice(0, 1) }, { jobs: tasks.slice(1) }];
    }
    return [current];
  };
}

test('完整 SHA 的最新 CI 和当前 attempt 所有指定 job 成功', () => {
  assert.equal(checkRelease([sha], fixture()).result, 'CI passed');
});
test('无 CI、其他 SHA 或错误事件不能成功', () => {
  for (const runs of [
    [],
    [{ ...run, head_sha: 'b'.repeat(40) }],
    [{ ...run, event: 'pull_request' }],
  ]) {
    assert.throws(() => checkRelease([sha], fixture({ runs })), /没有/);
  }
});
test('新一轮失败不能由历史成功覆盖，等待/取消/跳过均失败', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', null]) {
    assert.throws(
      () =>
        checkRelease(
          [sha],
          fixture({
            runs: [{ ...run, id: 19 }, run],
            current: { ...run, conclusion },
          }),
        ),
      /未成功/,
    );
  }
  assert.throws(
    () => checkRelease([sha], fixture({ current: { ...run, status: 'in_progress' } })),
    /未成功/,
  );
});
test('必需 job 缺失或跳过不能由 workflow success 掩盖', () => {
  for (const tasks of [
    [],
    jobs.slice(0, 1),
    [jobs[0], { ...jobs[1], conclusion: 'skipped' }],
    [jobs[0], { ...jobs[1], conclusion: 'failure' }],
  ]) {
    assert.throws(() => checkRelease([sha], fixture({ tasks })), /缺少成功/);
  }
});
test('详情 SHA 不符或响应格式损坏时失败关闭', () => {
  assert.throws(
    () => checkRelease([sha], fixture({ current: { ...run, head_sha: 'b'.repeat(40) } })),
    /未成功/,
  );
  assert.throws(() => checkRelease([sha], () => [{}]));
});
test('PR head 变化被拒绝，当前 PR head 成功', () => {
  assert.throws(
    () => checkRelease([sha, '--pr', '2'], fixture({ prHead: 'b'.repeat(40) })),
    /当前 head/,
  );
  const prRun = { ...run, event: 'pull_request' };
  assert.equal(
    checkRelease([sha, '--pr', '2'], fixture({ runs: [prRun], current: prRun })).event,
    'pull_request',
  );
  let reads = 0;
  const api = fixture({ runs: [prRun], current: prRun });
  assert.throws(
    () =>
      checkRelease([sha, '--pr', '2'], (endpoint) => {
        if (endpoint.includes('/pulls/') && ++reads === 2) return [{ state: 'closed' }];
        return api(endpoint);
      }),
    /仍开放/,
  );
});
test('API 错误不会被当作没有检查的成功', () => {
  assert.throws(
    () =>
      checkRelease([sha], () => {
        throw new Error('offline');
      }),
    /offline/,
  );
});
test('真实 CLI 对无效参数返回非零', () => {
  const result = spawnSync(process.execPath, ['scripts/check-release.mjs', 'main'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /完整小写 SHA/);
});
