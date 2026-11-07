// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function loadViewerLanguage() {
  vi.resetModules();
  return import('../src/viewer/i18n');
}

test('an English browser starts in Chinese without a saved preference', async () => {
  vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });

  const { i18n } = await loadViewerLanguage();

  expect(i18n.language).toBe('zh');
  expect(document.documentElement.lang).toBe('zh-CN');
});

test('a saved English preference wins and a manual change persists', async () => {
  vi.stubGlobal('navigator', { language: 'zh-CN', languages: ['zh-CN'] });
  localStorage.setItem('anjian.locale', 'en');

  const { i18n, setViewerLanguage } = await loadViewerLanguage();

  expect(i18n.language).toBe('en');
  expect(document.documentElement.lang).toBe('en');

  await setViewerLanguage('zh');
  expect(i18n.language).toBe('zh');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(localStorage.getItem('anjian.locale')).toBe('zh');
});
