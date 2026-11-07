import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';

export { Trans, useTranslation } from 'react-i18next';

const LOCALE_KEY = 'anjian.locale';

function savedLanguage() {
  try {
    return localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

export function initialViewerLanguage(saved: string | null): 'en' | 'zh' {
  return saved === 'en' ? 'en' : 'zh';
}

function init(instance: I18n, preferences: readonly string[]) {
  const preferred = preferences.find((language) => /^(zh|en)(?:-|$)/i.test(language));
  void instance.init({
    lng: preferred?.toLowerCase().startsWith('en') ? 'en' : 'zh',
    fallbackLng: 'zh',
    supportedLngs: ['en', 'zh'],
    resources: { en: { translation: en }, zh: { translation: zh } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

export function createViewerI18n(preferences: readonly string[]) {
  return init(i18next.createInstance(), preferences);
}

export const i18n = init(i18next.createInstance().use(initReactI18next), [
  initialViewerLanguage(savedLanguage()),
]);

function updateDocumentLanguage(language: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
}

i18n.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage(i18n.language);

export async function setViewerLanguage(language: 'en' | 'zh') {
  try {
    localStorage.setItem(LOCALE_KEY, language);
  } catch {
    // A denied storage write should not prevent a language change for this tab.
  }
  await i18n.changeLanguage(language);
}
export const t = i18n.t.bind(i18n);
