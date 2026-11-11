import { ArrowUpRight, ChevronRight, Info } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: '用画板批注推进设计',
  description: '从画板上的具体反馈，到 Agent 读取批注并修改作品。',
};
export default function UseCases() {
  return (
    <main className="case" id="main-content">
      <div className="crumb">
        <Link href="/docs">使用指南</Link>
        <ChevronRight />
        <span>使用案例</span>
      </div>
      <h1 className="dh">让设计反馈，落在具体位置。</h1>
      <p className="lead">
        这份文档站就是一个例子：先在案间看设计稿，圈出想改的地方，再让 Agent
        读取批注、修改作品。讨论和修改始终围绕同一份画板。
      </p>
      <ol aria-label="协作步骤" className="flow">
        {['查看设计稿', '在画板批注', '让 Agent 修改'].map((title, index) => (
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
            title: '在画板上，指出问题',
            text: '图标太小、文字太多，或者展示需要调整。直接在对应位置批注，意见和设计放在一起。',
            alt: '案间设计画板右侧的四条评论分别指出搜索图标、顶栏图标、冗余文字和首页展示的问题。',
            caption: '案间工作台 · 修改前的设计稿与四条具体反馈。',
          },
          {
            image: 'agent-feedback.png',
            title: '回到会话，交给 Agent',
            text: '把作品链接发给已接入案间的 Agent，请它读取全部批注。修改后回到同一份作品继续检查。',
            alt: 'Lody 会话中用户发送画板链接并要求处理评论，Agent 开始读取全部批注。',
            caption: 'Lody 会话 · 用户发出处理请求。评论不会自动唤醒 Agent。',
          },
        ].map((item, index) => (
          <figure className="fig card" key={item.image}>
            <div className="fig-h">
              <span className="step-tag">步骤 {index + 1}</span>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </div>
            <div className="shot">
              <a
                aria-label={`查看原图：${item.title}`}
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
                查看原图
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="note">
        <Info />
        <p>
          截图记录的是实际过程，不代表验收完成。公开作品是只读快照，草稿修改不会自动更新公开版本。批注发生在有权限的工作台中。
        </p>
        <a
          className="btn btn-ghost btn-sm"
          href="https://anjian.cosine.ren/s/eTPVcN0J7yUd7-a1Gu9fv0FSsKRP3b7fUGoGqyfKfzA"
        >
          查看公开作品
          <ArrowUpRight />
        </a>
      </div>
    </main>
  );
}
