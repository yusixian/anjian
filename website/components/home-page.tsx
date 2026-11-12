import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Code,
  FileText,
  Github,
  Laptop,
  Link as LinkIcon,
  PanelsTopLeft,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { BrandLogo } from '@/components/brand';
import { Artwork, Workbench } from '@/components/illustrations';
import { type Locale, localePath } from '@/lib/i18n';

export function HomePage({ locale }: { locale: Locale }) {
  const paths = [
    {
      Icon: Laptop,
      title: locale === 'zh' ? '在自己的电脑上开始' : 'Start on your own computer',
      description:
        locale === 'zh'
          ? '构建并启动案间，创建第一份作品。'
          : 'Build and start Anjian, then create your first artifact.',
      label: locale === 'zh' ? '本机使用指南' : 'Local setup guide',
      href: '/docs/local',
    },
    {
      Icon: LinkIcon,
      title: locale === 'zh' ? '发个链接，让朋友看看' : 'Send a link to a friend',
      description:
        locale === 'zh'
          ? '创建公开快照，对方无需登录即可查看。'
          : 'Publish a snapshot they can view without signing in.',
      label: locale === 'zh' ? '公开分享' : 'Public sharing',
      href: '/docs/sharing',
    },
    {
      Icon: Users,
      title: locale === 'zh' ? '给朋友一个独立空间' : 'Give friends their own space',
      description:
        locale === 'zh'
          ? '通过 GitHub 邀请，让朋友管理自己的作品。'
          : 'Invite friends through GitHub to manage their own artifacts.',
      label: locale === 'zh' ? '邀请朋友' : 'Invite friends',
      href: '/docs/members',
    },
  ];
  const kinds = [
    {
      Icon: PanelsTopLeft,
      title: locale === 'zh' ? '画板' : 'Artboards',
      description:
        locale === 'zh'
          ? '多个方案并排比较，批注落到具体元素。'
          : 'Compare alternatives side by side and comment on specific elements.',
      href: '/docs/artboards',
    },
    {
      Icon: FileText,
      title: locale === 'zh' ? '文档' : 'Documents',
      description:
        locale === 'zh'
          ? '选中文字批注，也能直接改字、对比历史。'
          : 'Comment on selected text, edit words, and compare history.',
      href: '/docs/documents',
    },
    {
      Icon: Code,
      title: locale === 'zh' ? 'HTML 预览' : 'HTML previews',
      description:
        locale === 'zh'
          ? '在隔离环境里试用页面交互，再提交反馈。'
          : 'Try interactions in an isolated preview, then send feedback.',
      href: '/docs/html',
    },
  ];

  return (
    <div className="home-bg">
      <main className="home" id="main-content">
        <section className="hero">
          <div>
            <h1 className="display">
              {locale === 'zh' ? '把想法摆出来，' : 'Put ideas on the canvas.'}
              <br />
              {locale === 'zh' ? '让讨论有个' : 'Give feedback a '}
              <em>{locale === 'zh' ? '落点。' : 'place.'}</em>
            </h1>
            <p className="hero-copy">
              {locale === 'zh'
                ? '画板里比较方案，文档上留下批注，HTML 中试用原型。和你的 Agent\n              一起，把反馈变成下一版作品。'
                : 'Compare designs on artboards, comment on documents, and try HTML prototypes. Work with your Agent to turn feedback into the next version.'}
            </p>
            <div className="cta">
              <Link className="btn btn-primary" href={localePath('/docs/local', locale)}>
                {locale === 'zh' ? '开始本机使用' : 'Start locally'}
                <ArrowRight />
              </Link>
              <Link className="btn btn-ghost" href={localePath('/docs', locale)}>
                {locale === 'zh' ? '了解全部功能' : 'Explore the features'}
              </Link>
            </div>
          </div>
          <Workbench locale={locale} />
        </section>
        <section aria-labelledby="start-title" className="sec">
          <h2 className="sec-h" id="start-title">
            {locale === 'zh' ? '你想从哪里开始？' : 'Where would you like to start?'}
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
            {locale === 'zh' ? '三种作品，同一套批注' : 'Three formats. One feedback workflow.'}
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
            {locale === 'zh' ? '案间应用 · AGPL-3.0-only' : 'Anjian app · AGPL-3.0-only'}
          </span>
          <span className="foot-r">
            <a href="https://github.com/yusixian/anjian">
              <Github />
              GitHub
            </a>
            <Link href={localePath('/docs/about', locale)}>
              {locale === 'zh' ? '开源与许可' : 'Source and licensing'}
              <ArrowUpRight />
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}
