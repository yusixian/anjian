import { appendFileSync, readFileSync } from 'node:fs';

const sourceRecord = readFileSync(new URL('../UPSTREAM.md', import.meta.url), 'utf8');
const baseline = sourceRecord.match(/^## 当前对照版本\s*\n[^\n]*核对 Ryugi 正式版 `(v\d+\.\d+\.\d+)`/m)?.[1];
if (!baseline) throw new Error('Missing audited Ryugi release under 当前对照版本 in UPSTREAM.md.');

const { tag_name: latest, draft, prerelease, published_at: publishedAt } = JSON.parse(
  readFileSync(0, 'utf8'),
);
if (!/^v\d+\.\d+\.\d+$/.test(latest) || draft !== false || prerelease !== false || !publishedAt) {
  throw new Error('Expected a published stable Ryugi release from the GitHub Releases API.');
}

const repository = 'https://github.com/Innei/ryugi';
const lines = [
  '## Ryugi release check',
  '',
  `- Audited baseline: [${baseline}](${repository}/releases/tag/${baseline})`,
  `- Latest stable release: [${latest}](${repository}/releases/tag/${latest})`,
  '',
];

if (latest === baseline) {
  lines.push('The latest stable release is already the audited baseline.');
} else {
  lines.push(
    `[Review the release differences](${repository}/compare/${baseline}...${latest}) and record the findings in [Anjian #55](https://github.com/yusixian/anjian/issues/55).`,
  );
}

const report = lines.join('\n') + '\n';
process.stdout.write(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
