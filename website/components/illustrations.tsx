import type { Locale } from '@/lib/i18n';
// Decorative illustrations transcribed from docs/brand/design-src/gen_docs.py.
const workbench =
  '<div class="wb" role="img" aria-label="案间画板示意：山野旅行首页的两个方案并排，方案 B 被选中；你在标题处批注“再多留一点空间”，Agent 回复已修改。示意图，不是产品截图。"><div class="wb-bar"><span class="logo-pair"><img class="logo light-logo" src="/anjian.svg" alt=""/><img class="logo dark-logo" src="/anjian-dark.svg" alt=""/></span><span>山野旅行</span><span class="sep">/</span><b>首页探索</b><div class="wb-end"><span class="stack"><span class="av av-me">你</span><span class="av av-ai">AI</span></span><span class="wb-share"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13"/></svg>分享</span></div></div><div class="wb-cv"><div class="mb mb-a"><span class="mb-l"><b>方案 A</b>满幅插画</span><div class="mnav">山野<i><s></s><s></s></i></div><div class="mt">去山里，<br>找回节奏。</div><div class="mc">慢慢走，多看看。</div><div class="scn"><div class="sun"></div><div class="hl hl1"></div><div class="hl hl2"></div></div><span class="mcta">开始探索</span></div><div class="mb mb-b"><span class="mb-l"><b>方案 B</b>已选择</span><i class="hd hd1"></i><i class="hd hd2"></i><i class="hd hd3"></i><i class="hd hd4"></i><div class="mnav">山野<i><s></s><s></s></i></div><div class="mt">把日常<br>留在山脚。</div><div class="mc">向山而行，慢一点也没关系。</div><div class="scn"><div class="sun"></div><div class="hl hl1"></div><div class="hl hl2"></div></div><span class="mcta">开始探索</span></div><span class="pin">1</span><span class="cursor"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 4.5 11 20l2.3-6.7L20 11Z"/></svg></span><div class="thread"><div class="msg"><span class="av av-me">你</span><div style="flex:1"><div class="msg-h"><b>你</b>刚刚</div><p>选 B，标题再多留一点空间。</p></div></div><div class="msg"><span class="av av-ai">AI</span><div style="flex:1"><div class="msg-h"><b>Agent</b><span class="done"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6.5 9.5 17 4 11.5"/></svg>已修改</span></div><p>标题间距已加到 26px。</p></div></div></div><div class="tools"><span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 4.5 11 20l2.3-6.7L20 11Z"/></svg></span><span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10.5V4.5a1.5 1.5 0 0 0-3 0v6M12 10V5.5a1.5 1.5 0 0 0-3 0V13"/><path d="M18 8.5a1.5 1.5 0 0 1 3 0V14a7.5 7.5 0 0 1-7.5 7.5h-1.2a7.5 7.5 0 0 1-5.4-2.3L3.6 15.8a1.6 1.6 0 0 1 2.3-2.3L9 16"/></svg></span><span class="on"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5a2 2 0 0 1-2 2H8l-4.5 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z"/></svg></span></div><span class="zoom">75%</span></div></div>';
const artwork = [
  '<div class="ka-1"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div><div class="ka-2"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div><div class="ka-3"><span class="blk"></span><span class="ln"></span><span class="ln" style="width:50%"></span></div><span class="kpin">1</span>',
  '<div class="kd"><span class="ln h"></span><span class="ln"></span><span class="ln" style="width:88%"></span><span class="mark"></span><span class="ln" style="width:70%"></span><span class="ln"></span><span class="ln" style="width:56%"></span></div><div class="bub"><b><span class="av av-me">你</span>批注</b>这句换个说法？</div>',
  '<div class="kh"><div class="kh-bar"><s></s><s></s><s></s><em></em></div><div class="kh-b"><span class="ln h" style="height:8px;width:50%;background:var(--ink2);opacity:.75;margin-bottom:12px"></span><span class="ln"></span><span class="ln" style="width:72%"></span><span class="kh-btn">预约</span></div></div><span class="kh-tag">可交互</span><span class="kh-cur"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 4.5 11 20l2.3-6.7L20 11Z"/></svg></span>',
];
const englishLabels: Record<string, string> = {
  '慢慢走，多看看。': 'Walk slowly, see more.',
  '案间画板示意：山野旅行首页的两个方案并排，方案 B 被选中；你在标题处批注“再多留一点空间”，Agent 回复已修改。示意图，不是产品截图。':
    'Illustration of an Anjian artboard: two hiking home page options, with option B selected. You ask for more space around the heading and the Agent replies that it is updated. This is an illustration, not a product screenshot.',
  '山野旅行': 'Mountain trails',
  '首页探索': 'Home explorations',
  '方案 A': 'Option A',
  '方案 B': 'Option B',
  '满幅插画': 'Full illustration',
  '已选择': 'Selected',
  '山野': 'Trails',
  '去山里，<br>找回节奏。': 'Head uphill.<br>Find your pace.',
  '把日常<br>留在山脚。': 'Leave the rush<br>behind.',
  '向山而行，慢一点也没关系。': 'Take the trail at your own pace.',
  '开始探索': 'Explore',
  '选 B，标题再多留一点空间。': 'Choose B. Give the heading more space.',
  '标题间距已加到 26px。': 'Heading spacing is now 26px.',
  '刚刚': 'Just now',
  '已修改': 'Updated',
  '分享': 'Share',
  '批注': 'Comment',
  '这句换个说法？': 'Could we rephrase this?',
  '预约': 'Book',
  '可交互': 'Interactive',
  '你': 'You',
};
function translated(html: string, locale: Locale) {
  if (locale === 'zh') return html;
  for (const [original, english] of Object.entries(englishLabels))
    html = html.replaceAll(original, english);
  return html;
}
export function Workbench({ locale }: { locale: Locale }) {
  return (
    <div className="wb-fit" dangerouslySetInnerHTML={{ __html: translated(workbench, locale) }} />
  );
}
export function Artwork({ index, locale }: { index: number; locale: Locale }) {
  return (
    <div
      aria-hidden="true"
      className="art"
      dangerouslySetInnerHTML={{ __html: translated(artwork[index], locale) }}
    />
  );
}
