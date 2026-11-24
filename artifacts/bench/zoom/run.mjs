import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_MS = Number(process.env.BENCH_BUDGET_MS ?? 18.2);
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS ?? 6000);
const RUNS = Number(process.env.BENCH_RUNS ?? 3);
const CLI = path.resolve(here, '../../dist/cli.cjs');
const CHROME =
  process.env.CHROME_PATH ??
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }[process.platform] ??
  'google-chrome';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function connect(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let seq = 0;
  const waiting = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
      ?.result?.value;
  return { send, evaluate, close: () => ws.close() };
}

function stats(frames) {
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const total = frames.reduce((sum, frame) => sum + frame, 0);
  return {
    frames: frames.length,
    avgFps: Math.round((frames.length * 1000) / total),
    p95ms: +p95.toFixed(1),
    worstMs: Math.round(sorted.at(-1)),
    over33: frames.filter((frame) => frame > 33).length,
  };
}

async function measure(devtools, url) {
  const targets = async () => (await fetch(`${devtools}/json/list`)).json();
  const page = await connect((await targets()).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await page.send('Page.enable');
  try {
    const navigation = await page.send('Page.navigate', { url });
    if (navigation.error || navigation.result?.errorText) throw new Error('Cannot open benchmark');
    const boardUrl = await until(
      () => page.evaluate("document.querySelector('[data-board=q1-a-0] iframe')?.src"),
      15_000,
      'the benchmark board frame',
    );
    const board = await fetch(boardUrl);
    if (!board.ok || !(await board.text()).includes('谁在写这一段'))
      throw new Error('Benchmark frame did not load the expected fixture.');
    await sleep(SETTLE_MS);
    await page.evaluate(`(() => {
    window.__frames = null;
    let last = performance.now();
    const tick = (now) => {
      if (window.__frames) window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
    const { width, height } = await page.evaluate('({ width: innerWidth, height: innerHeight })');
    const x = Math.round(width / 2);
    const y = Math.round(height / 2);
    const boardWidth =
      "document.querySelector('[data-board=q1-a-0]').getBoundingClientRect().width";
    const initialWidth = await page.evaluate(boardWidth);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await page.evaluate('window.__frames = []');
    for (let cycle = 0; cycle < 4; cycle++)
      for (const direction of [-1, 1]) {
        for (let i = 0; i < 60; i++) {
          void page.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX: 0,
            deltaY: direction * 1.5,
            modifiers: 2,
          });
          await sleep(8);
        }
        if (cycle === 0 && direction === -1 && (await page.evaluate(boardWidth)) === initialWidth)
          throw new Error('Wheel input did not zoom the benchmark canvas.');
      }
    const frames = await page.evaluate(
      '(() => { const f = window.__frames; window.__frames = null; return f; })()',
    );
    if (!frames || frames.length < 2) throw new Error('Chrome did not record zoom frames.');
    return stats(frames.slice(1));
  } finally {
    page.close();
  }
}

async function scenario(devtools, url) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) runs.push(await measure(devtools, url));
  const median = runs.toSorted((a, b) => a.p95ms - b.p95ms)[Math.floor(RUNS / 2)];
  return {
    scenario: 'local',
    ...median,
    p95msRuns: runs.map((run) => run.p95ms),
    pass: median.p95ms <= BUDGET_MS,
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-zoom-'));
const root = path.join(tmp, '.anjian', 'artifacts');
const env = {
  ...process.env,
  ANJIAN_SERVER_HOME: path.join(tmp, 'server'),
  ANJIAN_CLIENT_HOME: path.join(tmp, 'client'),
  ANJIAN_RUNTIME_DIR: path.join(tmp, 'runtime'),
  ANJIAN_ARTIFACTS_PORTS: '0',
  ANJIAN_ARTIFACTS_BOARD_PORTS: '0',
  ANJIAN_NO_UPDATE_CHECK: '1',
};
const run = (...args) =>
  execFileSync(process.execPath, [CLI, ...args, '--project-dir', tmp, '--json'], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
let started = false;
let chrome;
try {
  fs.cpSync(path.join(here, 'fixture'), path.join(root, 'artboard', 'zoom-bench'), {
    recursive: true,
  });
  const output = run(
    'start',
    '--background',
    '--no-open',
    '--url-host',
    '127.0.0.1',
    '--artifact',
    'artboard/zoom-bench',
  );
  started = true;
  const { link } = JSON.parse(output.trim().split('\n').at(-1));
  if (!link) throw new Error('Anjian did not return an artboard link.');
  const profile = path.join(tmp, 'chrome');
  chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,960',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const devtoolsPort = await until(
    () => {
      try {
        return fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      } catch {
        return null;
      }
    },
    20_000,
    'Chrome to open its DevTools port',
  );
  const result = await scenario(`http://127.0.0.1:${devtoolsPort}`, link);
  console.info(JSON.stringify(result));
  if (!result.pass) {
    console.error(`zoom P95 is over the ${BUDGET_MS} ms budget`);
    process.exitCode = 1;
  }
} finally {
  if (chrome) {
    chrome.kill();
    await sleep(500);
  }
  try {
    if (started) run('stop');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
