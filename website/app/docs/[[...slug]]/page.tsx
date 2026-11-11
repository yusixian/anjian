import defaultComponents from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Environment, Notice, Step,Steps } from '@/components/docs-content';
import { MobileTOC } from '@/components/mobile-toc';
import meta from '@/content/docs/meta.json';
import { source } from '@/lib/source';

type Props = { params: Promise<{ slug?: string[] }> };
export default async function Page({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;
  const pages = meta.pages
    .filter((slug) => !slug.startsWith('---'))
    .map((slug) => source.getPage(slug === 'index' ? [] : [slug]))
    .filter((item) => item !== undefined);
  const index = pages.findIndex((item) => item.url === page.url);
  const previous = pages[index - 1];
  const next = pages[index + 1];
  const pager = (
    <nav aria-label="前后篇" className="docs-pager">
      {previous ? (
        <Link href={previous.url}>
          <small>上一篇</small>
          <b>
            <ArrowLeft />
            {previous.data.title}
          </b>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link className="pager-next" href={next.url}>
          <small>下一篇</small>
          <b>
            {next.data.title}
            <ArrowRight />
          </b>
        </Link>
      )}
    </nav>
  );
  return (
    <DocsPage
      breadcrumb={{ enabled: false }}
      footer={{ component: pager }}
      tableOfContentPopover={{ component: <MobileTOC /> }}
      toc={page.data.toc}
      tableOfContent={{
        footer: (
          <a className="toc-feedback" href="https://github.com/yusixian/anjian/issues">
            发现错误？在 GitHub 反馈 ↗
          </a>
        ),
      }}
    >
      <div className="crumb">
        <Link href="/docs">使用指南</Link>
        <ChevronRight />
        <span>{page.data.title}</span>
      </div>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Content components={{ ...defaultComponents, Environment, Notice, Steps, Step }} />
      </DocsBody>
    </DocsPage>
  );
}
export function generateStaticParams() {
  return source.generateParams();
}
export async function generateMetadata({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
