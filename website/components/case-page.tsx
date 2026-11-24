import { ArrowUpRight, ChevronRight, Info } from 'lucide-react';
import Link from 'next/link';

import { type Locale, localePath } from '@/lib/i18n';

import { ScreenshotTranscript } from './screenshot-transcript';

export function caseMetadata(locale: Locale) {
  return {
    title: locale === 'zh' ? '用画板批注改设计稿' : 'Iterating on designs with artboard comments',
    description:
      locale === 'zh'
        ? '看看我们怎么用案间的画板批注，直接驱动 Agent 修改这个文档站的设计。'
        : 'How we designed this docs site by pinning comments on an Anjian artboard for our Agent.',
  };
}
export function UseCasesPage({ locale }: { locale: Locale }) {
  return (
    <main className="case" id="main-content">
      <div className="crumb">
        <Link href={localePath('/docs', locale)}>
          {locale === 'zh' ? '使用指南' : 'User guide'}
        </Link>
        <ChevronRight />
        <span>{locale === 'zh' ? '使用案例' : 'Use cases'}</span>
      </div>
      <h1 className="dh">
        {locale === 'zh'
          ? '直接指着设计稿，让 Agent 改。'
          : 'Point at the design, let your Agent fix it.'}
      </h1>
      <p className="lead">
        {locale === 'zh'
          ? '你现在看到的文档站就是这么做出来的：先让 Agent 出一版画板，我们在浏览器里圈出要改的地方，再把链接丢回会话让它逐条改完。'
          : 'This docs site itself was designed in Anjian: our Agent generated an artboard, we pinned comments directly on the spots we wanted changed, and handed the link back for the next pass.'}
      </p>
      <ol aria-label={locale === 'zh' ? '协作步骤' : 'Workflow steps'} className="flow">
        {[
          locale === 'zh' ? '看设计稿' : 'Review the artboard',
          locale === 'zh' ? '点位置写批注' : 'Pin comments on elements',
          locale === 'zh' ? '让 Agent 照着改' : 'Send link to Agent',
        ].map((title, index) => (
          <li className="fs" key={title}>
            {index > 0 && <i aria-hidden="true" className="fl" />}
            <span>{index + 1}</span>
            {title}
          </li>
        ))}
      </ol>
      <div className="figs">
        {[
          {
            image: 'artboard-comments.png',
            title: locale === 'zh' ? '在画板上直接标出问题' : 'Pin feedback right on the canvas',
            text:
              locale === 'zh'
                ? '图标太小、文字太啰嗦、排版不对劲，直接点在对应元素上留一条批注，不用截图再打字描述位置。'
                : 'Icon too small, copy too wordy, layout off? Click the exact element and leave a note—no screenshots or vague descriptions needed.',
            alt:
              locale === 'zh'
                ? '案间设计画板右侧的四条评论，分别指出搜索图标、顶栏图标、多余文字和首页排版问题。'
                : 'Four pinned comments on the Anjian design calling out search visibility, icon size, copy, and layout tweaks.',
            caption:
              locale === 'zh'
                ? '在案间画板上留下的 4 条具体修改意见。'
                : 'Four pinned comments on the docs site design in Anjian.',
          },
          {
            image: 'agent-feedback.png',
            title: locale === 'zh' ? '把链接发给 Agent 处理' : 'Hand the link back to your Agent',
            text:
              locale === 'zh'
                ? '回到聊天窗口，发一句「看看我的评论，修一下」。Agent 会通过 CLI 拉取所有批注和定位，改完再回复每条评论。'
                : 'Drop the artifact link in your chat and ask your Agent to address the comments. It pulls every thread via CLI, updates the files, and replies in place.',
            alt:
              locale === 'zh'
                ? '在会话中把画板链接发给 Agent，Agent 开始通过 CLI 读取全部批注。'
                : 'Chat session where the user sends the artboard link and the Agent reads all comments via CLI.',
            caption:
              locale === 'zh'
                ? '在会话中把链接发给 Agent，让它拉取评论并开始修改。'
                : 'Sending the link in chat so the Agent reads and resolves each thread.',
          },
        ].map((item, index) => (
          <figure className="fig card" key={item.image}>
            <div className="fig-h">
              <span className="step-tag">
                {locale === 'zh' ? `第 ${index + 1} 步` : `Step ${index + 1}`}
              </span>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </div>
            <div className="shot">
              <a
                aria-label={`${locale === 'zh' ? '查看原图：' : 'Open full image: '}${item.title}`}
                href={`/use-cases/${item.image}`}
                rel="noreferrer"
                target="_blank"
              >
                <img
                  alt={item.alt}
                  height={index === 0 ? 1868 : 1786}
                  src={`/use-cases/${item.image}`}
                  width={index === 0 ? 2374 : 1944}
                />
              </a>
            </div>
            <figcaption>
              {item.caption}{' '}
              <a
                className="case-caption-link"
                href={`/use-cases/${item.image}`}
                rel="noreferrer"
                target="_blank"
              >
                {locale === 'zh' ? '查看原图' : 'Open full image'}
              </a>
            </figcaption>
            <ScreenshotTranscript index={index} locale={locale} />
          </figure>
        ))}
      </div>
      <div className="note">
        <Info />
        <p>
          {locale === 'zh'
            ? '想直接看这份设计稿的公开只读版本？点右边按钮即可免登录预览。'
            : 'Want to browse the read-only snapshot of this artboard? No sign-in required.'}
        </p>
        <a
          className="btn btn-ghost btn-sm"
          href="https://anjian.cosine.ren/s/eTPVcN0J7yUd7-a1Gu9fv0FSsKRP3b7fUGoGqyfKfzA"
        >
          {locale === 'zh' ? '查看公开作品' : 'View public snapshot'}
          <ArrowUpRight />
        </a>
      </div>
    </main>
  );
}
