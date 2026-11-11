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

const paths = [
  {
    Icon: Laptop,
    title: '在自己的电脑上开始',
    description: '构建并启动案间，创建第一份作品。',
    label: '本机使用指南',
    href: '/docs/local',
  },
  {
    Icon: LinkIcon,
    title: '发个链接，让朋友看看',
    description: '创建公开快照，对方无需登录即可查看。',
    label: '公开分享',
    href: '/docs/sharing',
  },
  {
    Icon: Users,
    title: '给朋友一个独立空间',
    description: '通过 GitHub 邀请，让朋友管理自己的作品。',
    label: '邀请朋友',
    href: '/docs/members',
  },
];
const kinds = [
  {
    Icon: PanelsTopLeft,
    title: '画板',
    description: '多个方案并排比较，批注落到具体元素。',
    href: '/docs/artboards',
  },
  {
    Icon: FileText,
    title: '文档',
    description: '选中文字批注，也能直接改字、对比历史。',
    href: '/docs/documents',
  },
  {
    Icon: Code,
    title: 'HTML 预览',
    description: '在隔离环境里试用页面交互，再提交反馈。',
    href: '/docs/html',
  },
];
export default function Home() {
  return (
    <div className="home-bg">
      <main className="home" id="main-content">
        <section className="hero">
          <div>
            <h1 className="display">
              把想法摆出来，
              <br />
              让讨论有个<em>落点。</em>
            </h1>
            <p className="hero-copy">
              画板里比较方案，文档上留下批注，HTML 中试用原型。和你的 Agent
              一起，把反馈变成下一版作品。
            </p>
            <div className="cta">
              <Link className="btn btn-primary" href="/docs/local">
                开始本机使用
                <ArrowRight />
              </Link>
              <Link className="btn btn-ghost" href="/docs">
                了解全部功能
              </Link>
            </div>
          </div>
          <Workbench />
        </section>
        <section aria-labelledby="start-title" className="sec">
          <h2 className="sec-h" id="start-title">
            你想从哪里开始？
          </h2>
          <div className="grid3">
            {paths.map(({ Icon, title, description, label, href }) => (
              <Link className="card path" href={href} key={href}>
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
            三种作品，同一套批注
          </h2>
          <div className="grid3">
            {kinds.map(({ Icon, title, description, href }, index) => (
              <Link className="card kind" href={href} key={href}>
                <Artwork index={index} />
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
            案间 · AGPL-3.0 开源
          </span>
          <span className="foot-r">
            <a href="https://github.com/yusixian/anjian">
              <Github />
              GitHub
            </a>
            <Link href="/docs/about">
              开源与许可
              <ArrowUpRight />
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}
