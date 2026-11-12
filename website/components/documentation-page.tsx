import { TOC, TOCProvider } from 'fumadocs-ui/layouts/docs/page/slots/toc';
import defaultComponents from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { Environment, Notice, Step, Steps } from '@/components/docs-content';
import { type Locale, localePath } from '@/lib/i18n';
import { source } from '@/lib/source';

import { DocumentationTOCPopover } from './documentation-toc';
import { ScreenshotTranscript } from './screenshot-transcript';

export function DocumentationPage({ slug, locale }: { slug?: string[]; locale: Locale }) {
  const page = source.getPage(slug, locale);
  if (!page) notFound();
  const Content = page.data.body;
  return (
    <DocsPage
      slots={{ toc: { provider: TOCProvider, main: TOC, popover: DocumentationTOCPopover } }}
      toc={page.data.toc}
      tableOfContent={{
        footer: (
          <a
            className="mt-6 border-t pt-4 text-sm text-fd-muted-foreground"
            href="https://github.com/yusixian/anjian/issues"
          >
            {locale === 'zh'
              ? '发现错误？在 GitHub 反馈 ↗'
              : 'Found an error? Report it on GitHub ↗'}
          </a>
        ),
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <Content components={componentsFor(locale)} />
      </DocsBody>
    </DocsPage>
  );
}

function componentsFor(locale: Locale) {
  return {
    ...defaultComponents,
    Notice,
    Steps,
    Step,
    ScreenshotTranscript({ index }: { index: number }) {
      return <ScreenshotTranscript index={index} locale={locale} />;
    },
    Environment() {
      return <Environment locale={locale} />;
    },
    a({ href, ...props }: React.ComponentPropsWithoutRef<'a'>) {
      const Anchor = defaultComponents.a!;
      return <Anchor {...props} href={href ? localePath(href, locale) : href} />;
    },
  };
}
