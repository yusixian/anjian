// Run against a local production viewer build. Every API request is intercepted;
// stop/restart checks never reach a real service. No credentials are used.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node artifacts/bench/status-panel/run.mjs
// Optional: STATUS_URL=http://127.0.0.1:3195 STATUS_OUTPUT=/tmp/anjian-13
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.STATUS_URL || 'http://127.0.0.1:3195';
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname),
  'Use an isolated local viewer',
);
const output = process.env.STATUS_OUTPUT || path.join(os.tmpdir(), 'anjian-status-panel');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const matrix = [];
const sha = 'a9cbe863d8cf4408d838d6eb86058be72189bca3';
const scenarios = [];
for (const [size, viewport] of Object.entries({
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 680 },
  low: { width: 800, height: 400 },
})) {
  for (const language of ['en', 'zh'])
    for (const theme of ['dark', 'light'])
      scenarios.push({ size, viewport, language, theme, fixture: 'normal' });
}
for (const language of ['en', 'zh'])
  for (const fixture of ['long', 'fallback'])
    scenarios.push({
      size: 'stress',
      viewport: { width: 390, height: 520 },
      language,
      theme: language === 'en' ? 'dark' : 'light',
      fixture,
    });
const copy = {
  en: {
    panel: 'Anjian server',
    notes: 'Release notes',
    close: 'Close',
    commit: 'Show full commit',
    log: 'View log',
    hideLog: 'Hide log',
    stop: 'Stop',
    cancel: 'Cancel',
    confirm: 'Confirm stop',
    restart: 'Restart',
  },
  zh: {
    panel: '案间服务',
    notes: '更新说明',
    close: '关闭',
    commit: '查看完整提交标识',
    log: '查看日志',
    hideLog: '收起日志',
    stop: '停止',
    cancel: '取消',
    confirm: '确认停止',
    restart: '重启',
  },
};
async function contained(locator, viewport) {
  const box = await locator.boundingBox();
  assert(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    `Outside viewport: ${JSON.stringify(box)}`,
  );
}
try {
  for (const scenario of scenarios) {
    const { viewport, language, theme, fixture } = scenario;
    const id = `${scenario.size}-${language}-${theme}-${fixture}`;
    const page = await browser.newPage({ viewport, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const actions = [];
    let injected = false;
    await page.addInitScript((value) => localStorage.setItem('anjian.locale', value), language);
    if (fixture !== 'normal')
      await page.route('**/*.js', async (route) => {
        const response = await route.fetch();
        let body = await response.text();
        const pattern =
          /\{version:`[^`]+`,sha:(?:`[^`]*`|null),state:`(?:dirty|clean|exported|unknown)`,notes:\{zh:`[^`]*`,en:`[^`]*`\}\}/;
        if (pattern.test(body)) {
          const zh =
            '这是用于验证长篇更新说明的本地测试内容。正文应独立滚动，关闭入口始终可达。\n\n'.repeat(
              18,
            ) + '说明结束';
          const en =
            'These local fixture notes verify comfortable reading, a single scrolling body, and a reachable close action.\n\n'.repeat(
              18,
            ) + 'End of notes';
          body = body.replace(
            pattern,
            JSON.stringify({
              version: '0.2.0',
              sha: null,
              state: 'unknown',
              notes: { zh, en: fixture === 'fallback' ? '' : en },
            }),
          );
          injected = true;
        }
        await route.fulfill({ response, body });
      });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') actions.push(pathname);
      const projects = Array.from({ length: fixture === 'normal' ? 3 : 24 }, (_, index) => ({
        dir: `/fixture/project-${index}`,
        name: `Project ${index + 1}`,
        dormant: index > 0,
        artifacts: index + 4,
        lastUsedAt: 0,
      }));
      const status = {
        pid: 1,
        version: '0.2.0',
        startedAt: Date.now() - 3600000,
        lastActivity: Date.now(),
        clients: 1,
        port: 3195,
        boardPort: 3196,
        url: origin,
        live: { local: 6 },
        projects,
        build: {
          sha: fixture === 'normal' ? sha : null,
          state: fixture === 'normal' ? 'clean' : 'unknown',
          version: '0.2.0',
        },
      };
      const data =
        pathname === '/api/account'
          ? { role: 'owner', login: 'Owner' }
          : pathname === '/api/status'
            ? status
            : pathname === '/api/hub/artifacts'
              ? { artifacts: [], projects, warnings: [] }
              : pathname === '/api/hub/log'
                ? { lines: Array.from({ length: 80 }, (_, index) => `Local fixture log ${index}`) }
                : { entries: [], ok: true };
      await route.fulfill({ json: data });
    });
    await page.goto(origin);
    const labels = copy[language];
    const pill = page.getByRole('button', { name: /v0.2.0/ });
    await pill.click();
    const panel = page.getByRole('dialog').first();
    await contained(panel, viewport);
    await contained(panel.getByRole('button', { name: labels.stop, exact: true }), viewport);
    await page.screenshot({ path: path.join(output, `after-${id}.png`) });
    if (fixture === 'normal') {
      await panel.getByLabel(labels.commit).last().click();
      assert.equal(await panel.locator('code').last().textContent(), sha);
      await panel.getByLabel(labels.commit).last().click();
    } else {
      assert(injected, 'Build fixture must actually replace the bundled build info');
      assert(!(await panel.textContent()).includes('unknown ·'));
    }
    const notesTrigger = panel.getByRole('button', { name: labels.notes, exact: true });
    await notesTrigger.click();
    const reading = page.getByRole('dialog', { name: labels.notes, exact: true });
    await reading.waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), labels.close);
    await contained(reading.getByRole('button', { name: labels.close, exact: true }), viewport);
    for (let index = 0; index < 4; index++) {
      await page.keyboard.press('Tab');
      // Base UI redirects its focus guards on the next animation frame.
      await page.waitForTimeout(50);
      assert(
        await reading.evaluate((element) => element.contains(document.activeElement)),
        'Focus escaped modal',
      );
    }
    if (fixture === 'fallback') {
      assert.equal(await reading.locator('[lang]').getAttribute('lang'), 'zh');
      assert.equal(await reading.getByRole('status').count(), language === 'en' ? 1 : 0);
    }
    const notesText = reading.locator('[lang]');
    await notesText.click({ position: { x: 30, y: 12 } });
    assert(await reading.isVisible(), 'Clicking portal content dismissed its parent');
    await notesText.dblclick({ position: { x: 30, y: 12 } });
    assert(
      await page.evaluate(() => (window.getSelection()?.toString().length ?? 0) > 0),
      'Text selection failed',
    );
    assert(await reading.isVisible(), 'Selecting portal text dismissed its parent');
    assert.equal(
      await page
        .locator('button[aria-haspopup="dialog"][aria-expanded]')
        .getAttribute('aria-expanded'),
      'true',
    );
    assert.equal(await page.locator(`[role="dialog"][aria-label="${labels.panel}"]`).count(), 1);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const body = notesText.locator('..');
    const scroll = await body.evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY,
    }));
    assert.equal(scroll.overflow, 'auto');
    await page.screenshot({ path: path.join(output, `notes-${id}.png`) });
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    if (fixture !== 'normal') assert(await body.evaluate((element) => element.scrollTop > 0));
    await page.setViewportSize({ width: viewport.width, height: 320 });
    await contained(reading.getByRole('button', { name: labels.close, exact: true }), {
      width: viewport.width,
      height: 320,
    });
    await page.keyboard.press('Escape');
    await reading.waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    assert(
      await notesTrigger.evaluate((element) => element === document.activeElement),
      'Notes trigger focus not restored',
    );
    await contained(panel, { width: viewport.width, height: 320 });
    await contained(panel.getByRole('button', { name: labels.stop, exact: true }), {
      width: viewport.width,
      height: 320,
    });
    await page.setViewportSize(viewport);
    await notesTrigger.click();
    await page.getByRole('button', { name: labels.close, exact: true }).click();
    await reading.waitFor({ state: 'hidden' });
    await page.waitForTimeout(300);
    assert(await notesTrigger.evaluate((element) => element === document.activeElement));
    await panel.getByRole('button', { name: labels.log, exact: true }).click();
    const log = panel.locator('pre');
    await log.waitFor();
    assert.notEqual(await log.evaluate((element) => getComputedStyle(element).overflowY), 'auto');
    await panel.getByRole('button', { name: labels.stop, exact: true }).click();
    const cancel = panel.getByRole('button', { name: labels.cancel, exact: true });
    assert(await cancel.evaluate((element) => element === document.activeElement));
    await contained(cancel, viewport);
    assert(!actions.includes('/api/hub/stop'));
    await page.screenshot({ path: path.join(output, `confirm-${id}.png`) });
    await cancel.click();
    assert(!actions.includes('/api/hub/stop'));
    await panel.getByRole('button', { name: labels.stop, exact: true }).click();
    await panel.getByRole('button', { name: labels.confirm, exact: true }).click();
    await panel.getByRole('button', { name: labels.restart, exact: true }).click();
    assert.deepEqual(actions, ['/api/hub/stop', '/api/hub/restart']);
    assert.deepEqual(errors, []);
    matrix.push({
      ...scenario,
      result: 'pass',
      dialogScroll: scroll,
      checks: [
        'actions-in-viewport',
        'full-sha-or-unknown',
        'dialog-focus-and-tab-trap',
        'portal-click-and-text-selection-preserve-parent',
        'escape-and-close-focus-return',
        'resize-320',
        'single-log-scroll',
        'stop-cancel-confirm',
        'mock-restart',
      ],
      screenshot: `after-${id}.png`,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(
    path.join(output, 'matrix.json'),
    JSON.stringify(
      {
        browser: 'Google Chrome (Playwright, headless)',
        limits:
          'Viewport resize only; no physical mobile browser toolbar or screen-reader verification. All APIs, including destructive operations, are local fixtures.',
        scenarios: matrix,
      },
      null,
      2,
    ),
  );
}
console.info(`${matrix.length} scenarios passed; evidence: ${output}`);
