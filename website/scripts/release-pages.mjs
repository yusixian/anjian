import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseNotes } from '../../scripts/release/notes.mjs';

export function releasesFromChangelog(text) {
  return text
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const [heading, ...lines] = section.split('\n');
      const version = heading.trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) return [];
      const body = lines.join('\n').trim();
      const notes = parseNotes(body);
      const original = body.replaceAll(/<!--.*?-->/gs, '').trim();
      return [{ version, ...notes, original }];
    });
}

export function releasePage(releases, language) {
  const english = language === 'en';
  const title = english ? 'Release notes' : '更新说明';
  const description = english
    ? 'What changed in each Anjian release.'
    : '了解案间每个正式版本的变化。';
  const intro = english
    ? 'Release records do not indicate which version your server or local CLI is running.'
    : '发布记录不代表你的服务器或本机 CLI 已升级到相应版本。';
  const sections = releases.map((release) => {
    const other = english ? 'zh' : 'en';
    const content = release[language] || release[other] || release.original;
    const contentLanguage = release[language] ? language : release[other] ? other : undefined;
    const fallback = release[language]
      ? ''
      : english
        ? '> English translation is unavailable. The original release notes are shown below.\n\n'
        : '> 暂无中文翻译，以下显示原始更新说明。\n\n';
    return `## ${release.version}\n\n${fallback}<div${contentLanguage ? ` lang="${contentLanguage === 'zh' ? 'zh-CN' : 'en'}"` : ''}>\n\n${content || (english ? 'No release notes recorded.' : '此版本暂无更新说明。')}\n\n</div>`;
  });
  return `---\ntitle: ${title}\ndescription: ${description}\n---\n\n<div lang="${english ? 'en' : 'zh-CN'}" className="max-w-2xl [overflow-wrap:anywhere]">\n\n${intro}\n\n${sections.join('\n\n')}\n\n</div>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const releases = releasesFromChangelog(
    readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  );
  if (!releases.length) throw new Error('CHANGELOG.md contains no formal releases');
  // Remove the old generated name so upgraded worktrees do not index an extra guide.
  rmSync(new URL('../content/docs/updates-en.mdx', import.meta.url), { force: true });
  for (const language of ['zh', 'en']) {
    writeFileSync(
      new URL(`../content/docs/updates${language === 'en' ? '.en' : ''}.mdx`, import.meta.url),
      releasePage(releases, language),
    );
  }
}
