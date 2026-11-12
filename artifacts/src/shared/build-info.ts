export interface BuildInfo {
  notes: { zh: string; en: string };
  sha: string | null;
  state: 'clean' | 'dirty' | 'unknown' | 'exported';
  version: string;
}

declare const ANJIAN_BUILD_INFO: BuildInfo;
export const BUILD_INFO: BuildInfo =
  typeof ANJIAN_BUILD_INFO === 'undefined'
    ? { version: 'unknown', sha: null, state: 'unknown', notes: { zh: '', en: '' } }
    : ANJIAN_BUILD_INFO;

export function selectNotes(info: BuildInfo, language: string) {
  const requested = language.startsWith('en') ? 'en' : 'zh';
  const alternate = requested === 'en' ? 'zh' : 'en';
  const selected = info.notes[requested] ? requested : info.notes[alternate] ? alternate : null;
  return {
    language: selected,
    fallback: selected !== null && selected !== requested,
    text: selected ? info.notes[selected] : '',
  };
}
