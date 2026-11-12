import fs from 'node:fs';
import path from 'node:path';

export function parseNotes(text, strict = false) {
  const notes = { zh: [], en: [] };
  const blocks = [
    ...text.matchAll(
      /<!-- anjian:zh -->([\s\S]*?)<!-- anjian:en -->([\s\S]*?)<!-- anjian:end -->/g,
    ),
  ];
  for (const match of blocks) {
    for (const [index, language] of ['zh', 'en'].entries()) {
      const value = match[index + 1].replaceAll(/^\s*#### (中文|English)\s*$/gm, '').trim();
      if (strict && !value) throw new Error(`Missing ${language} release notes`);
      if (value) notes[language].push(value.replaceAll(/^ {2}/gm, ''));
    }
  }
  if (strict && (!blocks.length || !notes.zh.length || !notes.en.length)) {
    throw new Error(
      'Each changeset requires Chinese and English notes with anjian language markers',
    );
  }
  return { zh: notes.zh.join('\n\n'), en: notes.en.join('\n\n') };
}

export function currentNotes(root, version) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return { zh: '', en: '' };
  const sections = fs.readFileSync(file, 'utf8').split(/^## /m).slice(1);
  const section = sections.find((part) => part.split('\n')[0].trim() === version);
  if (!section) return { zh: '', en: '' };
  return parseNotes(section);
}

export function releaseBody(version, notes) {
  if (!notes.zh || !notes.en) throw new Error(`Release ${version} requires both languages`);
  return `# Anjian ${version}\n\n## 中文\n\n${notes.zh}\n\n## English\n\n${notes.en}\n`;
}
