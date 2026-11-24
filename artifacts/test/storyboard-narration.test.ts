import { expect, test } from 'vitest';

import { narrationSpeech } from '../src/shared/storyboard-narration';

const line = { id: 'line-1', locale: 'zh-CN' as const, text: '案间 Pro，案间和 A+B。', hint: '' };
const glossary = [
  { id: 'term-6', term: '案间', spoken: '安见' },
  { id: 'term-7', term: '案间 Pro', spoken: '专业版安见' },
  { id: 'term-8', term: 'A+B', spoken: 'A plus B' },
  { id: 'term-9', term: '安见', spoken: '递归替换' },
];

test('uses longest literal glossary matches in a single pass', () => {
  expect(narrationSpeech(line, glossary)).toBe('专业版安见，安见和 A plus B。');
  expect(line.text).toBe('案间 Pro，案间和 A+B。');
});

test('uses the complete spoken line before considering glossary terms', () => {
  expect(narrationSpeech({ ...line, hint: '  请打开案间 Pro。  ' }, glossary)).toBe(
    '请打开案间 Pro。',
  );
});
