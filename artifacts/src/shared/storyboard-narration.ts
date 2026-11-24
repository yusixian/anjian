import { isObject } from './comments';

export const MAX_NARRATION_LINES = 32;
export const MAX_NARRATION_TERMS = 40;
export const MAX_NARRATION_TEXT = 320;
export const MAX_NARRATION_TERM = 80;

export interface NarrationLine {
  hint: string;
  id: string;
  locale: 'zh-CN' | 'en-US';
  text: string;
}

export interface NarrationScript {
  lexicon: { id: string; spoken: string; term: string }[];
  lines: NarrationLine[];
}

export function isNarrationLocale(value: unknown): value is NarrationLine['locale'] {
  return value === 'zh-CN' || value === 'en-US';
}

const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

export function parseNarration(value: unknown): NarrationScript | null {
  if (
    !isObject(value) ||
    !Array.isArray(value.lines) ||
    value.lines.length > MAX_NARRATION_LINES ||
    !Array.isArray(value.lexicon) ||
    value.lexicon.length > MAX_NARRATION_TERMS
  )
    return null;
  const lines: NarrationLine[] = [];
  const lexicon: NarrationScript['lexicon'] = [];
  const ids = new Set<string>();
  for (const line of value.lines) {
    if (
      !isObject(line) ||
      typeof line.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(line.id) ||
      ids.has(line.id) ||
      !isNarrationLocale(line.locale) ||
      !bounded(line.text, MAX_NARRATION_TEXT) ||
      !bounded(line.hint, MAX_NARRATION_TEXT)
    )
      return null;
    ids.add(line.id);
    lines.push({ id: line.id, locale: line.locale, text: line.text, hint: line.hint });
  }
  ids.clear();
  for (const entry of value.lexicon) {
    if (
      !isObject(entry) ||
      typeof entry.id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !bounded(entry.term, MAX_NARRATION_TERM) ||
      !bounded(entry.spoken, MAX_NARRATION_TERM)
    )
      return null;
    ids.add(entry.id);
    lexicon.push({ id: entry.id, term: entry.term, spoken: entry.spoken });
  }
  return { lexicon, lines };
}

export function narrationSpeech(line: NarrationLine, lexicon: NarrationScript['lexicon']) {
  if (line.hint.trim()) return line.hint.trim();
  const terms = new Map<string, string>();
  for (const { term, spoken } of lexicon) {
    if (term.trim() && spoken.trim()) terms.set(term.trim(), spoken.trim());
  }
  if (!terms.size) return line.text.trim();
  const alternatives = [...terms.keys()]
    .sort((left, right) => right.length - left.length)
    .map((term) => term.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return line.text
    .trim()
    .replaceAll(new RegExp(alternatives.join('|'), 'gu'), (term) => terms.get(term)!);
}
