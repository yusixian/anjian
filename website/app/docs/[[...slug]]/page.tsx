import defaultComponents from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { Environment, Notice, Step, Steps } from '@/components/docs-content';
import { source } from '@/lib/source';

type Props = { params: Promise<{ slug?: string[] }> };
export default async function Page({ params }: Props) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();
  const Content = page.data.body;
  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{
        footer: (
          <a
            className="mt-6 border-t pt-4 text-sm text-fd-muted-foreground"
            href="https://github.com/yusixian/anjian/issues"
          >
            发现错误？在 GitHub 反馈 ↗
          </a>
        ),
      }}
    >
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
