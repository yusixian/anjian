import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Code,
  FileText,
  Github,
  Laptop,
  PanelsTopLeft,
  Server,
  Terminal,
} from 'lucide-react';
import Link from 'next/link';

import { BrandLogo } from '@/components/brand';
import { Artwork, Workbench } from '@/components/illustrations';
import { type Locale, localePath } from '@/lib/i18n';

export function HomePage({ locale }: { locale: Locale }) {
  const paths = [
    {
      Icon: Terminal,
      title: locale === 'zh' ? '已有工作台或收到邀请' : 'Invited or have an account',
      description:
        locale === 'zh'
          ? '登录工作台，三步把本地 CLI 和 Agent 接上来。'
          : 'Sign in to the workbench and pair your local CLI & Agent in 3 steps.',
      label: locale === 'zh' ? '连接设备与 Agent' : 'Connect CLI & Agent',
      href: '/docs/remote-cli',
    },
    {
      Icon: Laptop,
      title: locale === 'zh' ? '先在自己电脑上用' : 'Try it on your machine',
      description:
        locale === 'zh'
          ? '下载 macOS / Linux 安装包或源码构建，5 分钟建第一份作品。'
          : 'Download the macOS/Linux package or build from source in 5 minutes.',
      label: locale === 'zh' ? '本机安装与启动' : 'Local setup guide',
      href: '/docs/local',
    },
    {
      Icon: Server,
      title: locale === 'zh' ? '部署到自己的服务器' : 'Self-host on your server',
      description:
        locale === 'zh'
          ? '用 Docker 或 Dokploy 上线，配置域名、GitHub 登录与好友空间。'
          : 'Deploy with Docker or Dokploy, set up HTTPS, GitHub sign-in, and invites.',
      label: locale === 'zh' ? '自托管指南' : 'Self-hosting guide',
      href: '/docs/self-hosting',
    },
  ];
  const kinds = [
    {
      Icon: PanelsTopLeft,
      title: locale === 'zh' ? '画板与评审' : 'Artboards & Reviews',
      description:
        locale === 'zh'
          ? '多页设计并排对比、定点批注选方案，也支持白板、幻灯片和分镜。'
          : 'Compare layouts side by side, pin comments, vote on options, plus whiteboards, slides & storyboards.',
      href: '/docs/artboards',
    },
    {
      Icon: FileText,
      title: locale === 'zh' ? '文档' : 'Documents',
      description:
        locale === 'zh'
          ? '划词评论、浏览器直接改字、对比历史，还能直接发起评审问答和批准。'
          : 'Comment inline, edit copy directly, diff revisions, and collect answers or approvals.',
      href: '/docs/documents',
    },
    {
      Icon: Code,
      title: locale === 'zh' ? 'HTML 预览' : 'HTML previews',
      description:
        locale === 'zh'
          ? '在隔离沙盒里直接点交互，选中元素把反馈发给 Agent。'
          : 'Click through live prototypes inside a sandbox and send feedback to your Agent.',
      href: '/docs/html',
    },
  ];

  return (
    <div className="home-bg">
      <main className="home" id="main-content">
        <section className="hero">
          <div>
            <h1 className="display">
              {locale === 'zh' ? '给你的 AI Agent 一个' : 'A visual workbench for'}
              <br />
              {locale === 'zh' ? '看得见的' : 'you and your '}
              <em>{locale === 'zh' ? '作品工作台' : 'AI Agent'}</em>
            </h1>
            <p className="hero-copy">
              {locale === 'zh'
                ? '画板对比设计、文档划词批注、HTML 实机预览。在具体位置指出哪里要改，让 Agent 读完直接迭代下一版。'
                : 'Compare designs on artboards, comment right on documents, and test HTML live. Point to what needs changing and let your Agent ship the next version.'}
            </p>
            <div className="cta">
              <Link className="btn btn-primary" href={localePath('/docs', locale)}>
                {locale === 'zh' ? '5 分钟上手' : 'Quick start'}
                <ArrowRight />
              </Link>
              <a className="btn btn-ghost" href="/library">
                {locale === 'zh' ? '进入工作台' : 'Open Workbench'}
              </a>
            </div>
          </div>
          <Workbench locale={locale} />
        </section>
        <section aria-labelledby="start-title" className="sec">
          <h2 className="sec-h" id="start-title">
            {locale === 'zh' ? '从你的场景开始' : 'Pick your starting point'}
          </h2>
          <div className="grid3">
            {paths.map(({ Icon, title, description, label, href }) => (
              <Link className="card path" href={localePath(href, locale)} key={href}>
                <span className="tile">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="more">
                  {label}
                  <ArrowRight />
                </span>
                <span className="chev">
                  <ChevronRight />
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section aria-labelledby="kinds-title" className="sec">
          <h2 className="sec-h" id="kinds-title">
            {locale === 'zh' ? '三种作品，一套批注体验' : 'Three formats, one feedback loop'}
          </h2>
          <div className="grid3">
            {kinds.map(({ Icon, title, description, href }, index) => (
              <Link className="card kind" href={localePath(href, locale)} key={href}>
                <Artwork index={index} locale={locale} />
                <div className="kind-b">
                  <h3>
                    <Icon />
                    {title}
                  </h3>
                  <p>{description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <footer className="foot">
          <span className="foot-l">
            <BrandLogo />
            {locale === 'zh' ? '案间 · AGPL-3.0 开源' : 'Anjian · Open source (AGPL-3.0)'}
          </span>
          <span className="foot-r">
            <Link href={localePath('/docs/updates', locale)}>
              {locale === 'zh' ? '更新记录' : 'Updates'}
            </Link>
            <a href="https://github.com/yusixian/anjian">
              <Github />
              GitHub
            </a>
            <Link href={localePath('/docs/about', locale)}>
              {locale === 'zh' ? '开源与许可' : 'License & Credits'}
              <ArrowUpRight />
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}
