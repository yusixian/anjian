'use client';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { Github, Menu, Moon, Search, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useRef } from 'react';

import { type Locale, localePath, unprefixedPath } from '@/lib/i18n';

import { BrandLogo } from './brand';
import { LanguageSwitch } from './language-switch';

export function Header({ locale }: { locale: Locale }) {
  const links = [
    { href: '/docs', label: locale === 'zh' ? '使用指南' : 'User guide' },
    { href: '/docs/self-hosting', label: locale === 'zh' ? '自托管' : 'Self-hosting' },
    { href: '/use-cases', label: locale === 'zh' ? '使用案例' : 'Use cases' },
    { href: '/docs/updates', label: locale === 'zh' ? '更新说明' : 'Release notes' },
  ];

  const path = unprefixedPath(usePathname());
  const { resolvedTheme, setTheme } = useTheme();
  const { setOpenSearch } = useSearchContext();
  const menu = useRef<HTMLDetailsElement>(null);
  function themeToggle() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }
  const active = path.startsWith('/use-cases')
    ? '/use-cases'
    : path.startsWith('/docs/self-hosting')
      ? '/docs/self-hosting'
      : path.startsWith('/docs/updates')
        ? '/docs/updates'
        : path.startsWith('/docs')
          ? '/docs'
          : '';
  if (path === '/docs' || path.startsWith('/docs/')) return null;
  return (
    <header className="site-header">
      <Link
        aria-label={locale === 'zh' ? '案间文档首页' : 'Anjian documentation home'}
        className="brand"
        href={localePath('/', locale)}
      >
        <BrandLogo />
        {locale === 'zh' ? '案间' : 'Anjian'}
      </Link>
      <nav aria-label={locale === 'zh' ? '主导航' : 'Main navigation'} className="site-nav">
        {links.map((link) => (
          <Link
            aria-current={active === link.href ? 'page' : undefined}
            href={localePath(link.href, locale)}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="header-end">
        <LanguageSwitch locale={locale} />
        <a className="workbench-link" href="/library">
          {locale === 'zh' ? '进入工作台' : 'Open workspace'}
        </a>
        <button
          aria-label={locale === 'zh' ? '搜索文档' : 'Search docs'}
          className="search-button"
          onClick={() => setOpenSearch(true)}
        >
          <Search />
          <span>{locale === 'zh' ? '搜索文档' : 'Search docs'}</span>
          <kbd>⌘K</kbd>
        </button>
        <button
          aria-label={locale === 'zh' ? '切换深浅主题' : 'Toggle theme'}
          className="icon-button desktop-theme"
          onClick={themeToggle}
        >
          <Sun className="light-logo" />
          <Moon className="dark-logo" />
        </button>
        <a
          aria-label={locale === 'zh' ? 'GitHub 仓库' : 'GitHub repository'}
          className="icon-button desktop-github"
          href="https://github.com/yusixian/anjian"
        >
          <Github />
        </a>
        <details
          className="mobile-menu"
          ref={menu}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menu.current) {
              menu.current.open = false;
              menu.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary
            aria-label={locale === 'zh' ? '打开导航菜单' : 'Open navigation menu'}
            className="icon-button"
          >
            <Menu />
          </summary>
          <nav aria-label={locale === 'zh' ? '手机导航' : 'Mobile navigation'}>
            {links.map((link) => (
              <Link
                aria-current={active === link.href ? 'page' : undefined}
                href={localePath(link.href, locale)}
                key={link.href}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                {link.label}
              </Link>
            ))}
            <a href="/library">{locale === 'zh' ? '进入工作台' : 'Open workspace'}</a>
            <button onClick={themeToggle}>
              {locale === 'zh' ? '切换深浅主题' : 'Toggle theme'}
            </button>
            <a href="https://github.com/yusixian/anjian">
              {locale === 'zh' ? 'GitHub 仓库' : 'GitHub repository'}
            </a>
          </nav>
        </details>
      </div>
    </header>
  );
}
