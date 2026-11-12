import { describe, expect, it } from 'vitest';

import { type BuildInfo, selectNotes } from '../src/shared/build-info';

const info: BuildInfo = {
  version: '0.2.0',
  sha: null,
  state: 'unknown',
  notes: { zh: '中文', en: 'English' },
};
describe('offline build notes', () => {
  it('uses the selected language and explicitly identifies missing translation fallback', () => {
    expect(selectNotes(info, 'en-US')).toEqual({
      language: 'en',
      text: 'English',
      fallback: false,
    });
    expect(selectNotes(info, 'zh')).toEqual({ language: 'zh', text: '中文', fallback: false });
    expect(selectNotes({ ...info, notes: { zh: '中文', en: '' } }, 'en')).toEqual({
      language: 'zh',
      text: '中文',
      fallback: true,
    });
    expect(selectNotes({ ...info, notes: { zh: '', en: '' } }, 'en')).toEqual({
      language: null,
      text: '',
      fallback: false,
    });
  });
});

it('the standalone CLI reports its own build while --version remains compatible', async () => {
  const { execFileSync } = await import('node:child_process');
  const { version } = await import('../package.json');
  const output = execFileSync(process.execPath, ['dist/cli.cjs', 'version', '--json'], {
    encoding: 'utf8',
  });
  const build = JSON.parse(output);
  expect(build.type).toBe('cli-version');
  expect(build.version).toBe(version);
  expect(['clean', 'dirty', 'unknown', 'exported']).toContain(build.state);
  if (build.sha !== null) expect(build.sha).toMatch(/^[a-f0-9]{40}$/);
  expect(
    execFileSync(process.execPath, ['dist/cli.cjs', '--version'], { encoding: 'utf8' }).trim(),
  ).toBe(version);
});
